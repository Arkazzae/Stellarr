using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication.OpenIdConnect;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Protocols;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Microsoft.IdentityModel.Tokens;
using Stellarr.Api.Auth;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;

namespace Stellarr.Api.Tests;

/// <summary>
/// Sign-in through an OpenID Connect provider, against a provider that lives
/// in this class: it publishes fixed endpoints and signs the identity token
/// it hands back for whoever the test says is signing in.
/// </summary>
public sealed class OidcSignInFlowTests(StellarrWebApplicationFactory factory)
    : IClassFixture<StellarrWebApplicationFactory>
{
    private const string Issuer = "https://identity.test";
    private const string ClientId = "stellarr-tests";

    [Fact]
    public async Task ProviderIsNotOfferedUntilItIsConfigured()
    {
        using var client = factory.CreateClient();

        var status = await client.GetFromJsonAsync<JsonElement>("/api/auth/oidc");
        using var login = await client.GetAsync("/api/auth/oidc/login");

        Assert.False(status.GetProperty("enabled").GetBoolean());
        Assert.Equal(HttpStatusCode.NotFound, login.StatusCode);
    }

    [Fact]
    public async Task ConfiguredProviderIsOfferedUnderItsNameAndPeopleAreSentToIt()
    {
        using var provider = new FakeProvider();
        using var host = Host(provider);
        using var client = BrowserClient(host);

        var status = await client.GetFromJsonAsync<JsonElement>("/api/auth/oidc");
        using var login = await client.GetAsync("/api/auth/oidc/login");

        Assert.True(status.GetProperty("enabled").GetBoolean());
        Assert.Equal("Test IdP", status.GetProperty("displayName").GetString());
        Assert.Equal(HttpStatusCode.Redirect, login.StatusCode);
        var location = login.Headers.Location!;
        Assert.Equal($"{Issuer}/authorize", location.GetLeftPart(UriPartial.Path));
        var query = QueryHelpers.ParseQuery(location.Query);
        Assert.Equal(ClientId, query["client_id"]);
        Assert.Equal("code", query["response_type"]);
        Assert.Equal("S256", query["code_challenge_method"]);
        Assert.Equal("https://localhost/api/auth/oidc/callback", query["redirect_uri"]);
        Assert.Equal("openid profile email", query["scope"]);
    }

    [Theory]
    [InlineData("/invite/abc?source=oidc", "/invite/abc?source=oidc")]
    [InlineData("https://evil.example/", "/")]
    [InlineData("//evil.example/", "/")]
    public async Task LinkedAccountSignsInAndIsSentWhereItAskedToGoOnThisOrigin(string returnUrl, string expected)
    {
        using var provider = new FakeProvider();
        using var host = Host(provider);
        using var client = BrowserClient(host);
        var account = await CreateLinkedAccountAsync(provider);

        using var callback = await SignInThroughProviderAsync(client, provider, returnUrl);

        Assert.Equal(HttpStatusCode.Redirect, callback.StatusCode);
        Assert.Equal(expected, callback.Headers.Location!.OriginalString);
        var session = await client.GetFromJsonAsync<JsonElement>("/api/session");
        Assert.Equal(account.Id.ToString(), session.GetProperty("user").GetProperty("id").GetString());
        await using var scope = factory.OpenScope(out var db);
        Assert.Single(await db.UserSessions.Where(x => x.UserId == account.Id).ToListAsync());
    }

    [Fact]
    public async Task SignedInSessionCanBeRevokedLikeAnyOther()
    {
        using var provider = new FakeProvider();
        using var host = Host(provider);
        using var client = BrowserClient(host);
        var account = await CreateLinkedAccountAsync(provider);
        (await SignInThroughProviderAsync(client, provider, "/")).Dispose();

        using var logout = await client.PostAsync("/api/auth/logout", content: null);

        Assert.Equal(HttpStatusCode.NoContent, logout.StatusCode);
        await using var scope = factory.OpenScope(out var db);
        Assert.NotNull((await db.UserSessions.SingleAsync(x => x.UserId == account.Id)).RevokedAt);
    }

    [Fact]
    public async Task IdentityNobodyLinkedIsSentBackToLoginAndGetsNoSession()
    {
        using var provider = new FakeProvider { Subject = "stranger" };
        using var host = Host(provider);
        using var client = BrowserClient(host);

        using var callback = await SignInThroughProviderAsync(client, provider, "/");

        Assert.Equal("/login?oidc_error=not_linked", callback.Headers.Location!.OriginalString);
        var session = await client.GetFromJsonAsync<JsonElement>("/api/session");
        Assert.Equal(JsonValueKind.Null, session.GetProperty("user").ValueKind);
    }

    [Fact]
    public async Task LinkedButDisabledAccountIsSentBackToLogin()
    {
        using var provider = new FakeProvider();
        using var host = Host(provider);
        using var client = BrowserClient(host);
        var account = await CreateLinkedAccountAsync(provider, disabled: true);

        using var callback = await SignInThroughProviderAsync(client, provider, "/");

        Assert.Equal("/login?oidc_error=failed", callback.Headers.Location!.OriginalString);
        await using var scope = factory.OpenScope(out var db);
        Assert.False(await db.UserSessions.AnyAsync(x => x.UserId == account.Id));
    }

    [Theory]
    [InlineData("access_denied", "cancelled")]
    [InlineData("server_error", "failed")]
    public async Task ProviderRefusalIsReportedOnTheLoginPage(string error, string expected)
    {
        using var provider = new FakeProvider();
        using var host = Host(provider);
        using var client = BrowserClient(host);
        using var login = await client.GetAsync("/api/auth/oidc/login");
        var state = QueryHelpers.ParseQuery(login.Headers.Location!.Query)["state"].ToString();

        using var callback = await client.GetAsync(
            $"/api/auth/oidc/callback?error={error}&state={Uri.EscapeDataString(state)}");

        Assert.Equal(HttpStatusCode.Redirect, callback.StatusCode);
        Assert.Equal($"/login?oidc_error={expected}", callback.Headers.Location!.OriginalString);
    }

    /// <summary>The application with the provider configured and its endpoints pointed at <paramref name="provider"/>.</summary>
    private WebApplicationFactory<Program> Host(FakeProvider provider) => factory.WithWebHostBuilder(builder =>
    {
        builder.UseSetting("Oidc:Enabled", "true");
        builder.UseSetting("Oidc:Authority", Issuer);
        builder.UseSetting("Oidc:ClientId", ClientId);
        builder.UseSetting("Oidc:ClientSecret", "test-client-secret");
        builder.UseSetting("Oidc:DisplayName", "Test IdP");
        builder.ConfigureServices(services => services.PostConfigure<OpenIdConnectOptions>(
            ExternalOidcOptions.AuthenticationScheme,
            options =>
            {
                options.ConfigurationManager =
                    new StaticConfigurationManager<OpenIdConnectConfiguration>(provider.Configuration);
                options.Backchannel = new HttpClient(provider, disposeHandler: false);
            }));
    });

    /// <summary>A browser: it keeps the cookies of the sign-in and stays on the secure origin the provider's cookies need.</summary>
    private static HttpClient BrowserClient(WebApplicationFactory<Program> host) => host.CreateClient(
        new WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            HandleCookies = true,
            BaseAddress = new Uri("https://localhost"),
        });

    /// <summary>Goes to the provider and comes back with the code it would have issued; returns the reply to that return.</summary>
    private static async Task<HttpResponseMessage> SignInThroughProviderAsync(
        HttpClient client,
        FakeProvider provider,
        string returnUrl)
    {
        using var login = await client.GetAsync(
            $"/api/auth/oidc/login?returnUrl={Uri.EscapeDataString(returnUrl)}");
        Assert.Equal(HttpStatusCode.Redirect, login.StatusCode);
        var query = QueryHelpers.ParseQuery(login.Headers.Location!.Query);
        provider.Nonce = query["nonce"].ToString();

        return await client.GetAsync(
            $"/api/auth/oidc/callback?code=the-code&state={Uri.EscapeDataString(query["state"].ToString())}");
    }

    private async Task<User> CreateLinkedAccountAsync(FakeProvider provider, bool disabled = false)
    {
        await using var scope = factory.OpenScope(out var db);
        var user = (await DataModelSupport.AddUsersAsync(db, 1))[0];
        user.IsDisabled = disabled;
        db.ExternalIdentities.Add(new ExternalIdentity
        {
            Id = Guid.NewGuid(),
            UserId = user.Id,
            Issuer = Issuer,
            Subject = provider.Subject,
            CreatedAt = DateTime.UtcNow,
        });
        await db.SaveChangesAsync();
        return user;
    }

    private sealed class FakeProvider : HttpMessageHandler
    {
        private readonly RSA _rsa = RSA.Create(2048);
        private readonly RsaSecurityKey _key;

        public FakeProvider()
        {
            _key = new RsaSecurityKey(_rsa) { KeyId = "test-key" };
            Configuration = new OpenIdConnectConfiguration
            {
                Issuer = Issuer,
                AuthorizationEndpoint = $"{Issuer}/authorize",
                TokenEndpoint = $"{Issuer}/token",
            };
            Configuration.SigningKeys.Add(_key);
        }

        public OpenIdConnectConfiguration Configuration { get; }

        /// <summary>Who the identity token says is signing in. Unique per test, so linked accounts never collide.</summary>
        public string Subject { get; init; } = $"subject-{Guid.NewGuid():N}";

        /// <summary>The nonce of the sign-in under way, which the token must echo.</summary>
        public string Nonce { get; set; } = "";

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            if (request.Method != HttpMethod.Post || request.RequestUri?.AbsoluteUri != Configuration.TokenEndpoint)
            {
                return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NotFound));
            }

            var idToken = new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
            {
                Issuer = Issuer,
                Audience = ClientId,
                Expires = DateTime.UtcNow.AddMinutes(5),
                Claims = new Dictionary<string, object> { ["sub"] = Subject, ["nonce"] = Nonce },
                SigningCredentials = new SigningCredentials(_key, SecurityAlgorithms.RsaSha256),
            });
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = JsonContent.Create(new
                {
                    id_token = idToken,
                    access_token = "access-token",
                    token_type = "Bearer",
                    expires_in = 300,
                }),
            });
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                _rsa.Dispose();
            }
            base.Dispose(disposing);
        }
    }
}
