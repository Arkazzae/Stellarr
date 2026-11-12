using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication.OpenIdConnect;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Protocols;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Microsoft.IdentityModel.Tokens;
using Stellarr.Api.Auth;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;
using Stellarr.Api.Operations;

namespace Stellarr.Api.Tests;

/// <summary>
/// Sign-in through an OpenID Connect provider, against a provider that lives
/// in this class: it publishes fixed endpoints and signs the identity token
/// it hands back for whoever the test says is signing in.
/// </summary>
public sealed partial class OidcSignInFlowTests(StellarrWebApplicationFactory factory)
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
    public async Task ProviderSignInKeepsTheChoiceMadeBeforeLeaving()
    {
        using var provider = new FakeProvider();
        using var host = Host(provider);
        using var client = BrowserClient(host);
        var account = await CreateLinkedAccountAsync(provider);

        using var callback = await SignInThroughProviderAsync(client, provider, "/", keepSignedIn: false);

        Assert.Equal(HttpStatusCode.Redirect, callback.StatusCode);
        var cookie = Assert.Single(
            callback.Headers.GetValues("Set-Cookie"),
            header => header.Split('=', 2)[0].EndsWith("-session", StringComparison.Ordinal));
        Assert.DoesNotContain("expires=", cookie, StringComparison.OrdinalIgnoreCase);
        await using var scope = factory.OpenScope(out var db);
        Assert.True((await db.UserSessions.SingleAsync(x => x.UserId == account.Id)).ShortLived);
    }

    [Fact]
    public async Task NamedProviderSignsInThroughItsOwnRoutesBesideTheOriginal()
    {
        using var provider = new FakeProvider();
        using var work = new FakeProvider("https://work-identity.test");
        using var host = Host(provider, work);
        using var client = BrowserClient(host);
        var account = await CreateLinkedAccountAsync(work);

        var status = await client.GetFromJsonAsync<JsonElement>("/api/auth/oidc");
        var offered = status.GetProperty("providers").EnumerateArray()
            .Select(x => (x.GetProperty("id").GetString(), x.GetProperty("displayName").GetString(), x.GetProperty("loginUrl").GetString()))
            .ToArray();
        Assert.Equal(
            [("default", "Test IdP", "/api/auth/oidc/login"), ("work", "Work", "/api/auth/oidc/work/login")],
            offered);

        using var callback = await SignInThroughProviderAsync(client, work, "/", providerId: "work");

        Assert.Equal(HttpStatusCode.Redirect, callback.StatusCode);
        Assert.Equal("/", callback.Headers.Location!.OriginalString);
        var session = await client.GetFromJsonAsync<JsonElement>("/api/session");
        Assert.Equal(account.Id.ToString(), session.GetProperty("user").GetProperty("id").GetString());
    }

    [Fact]
    public async Task IdentityLinkedAtOneProviderDoesNotSignInThroughAnother()
    {
        using var provider = new FakeProvider();
        using var work = new FakeProvider("https://work-identity.test") { Subject = "shared-subject" };
        provider.Subject = "shared-subject";
        using var host = Host(provider, work);
        using var client = BrowserClient(host);
        await CreateLinkedAccountAsync(provider);

        // The same subject at another issuer is another person.
        using var callback = await SignInThroughProviderAsync(client, work, "/", providerId: "work");

        Assert.Equal("/login?oidc_error=not_linked", callback.Headers.Location!.OriginalString);
        var session = await client.GetFromJsonAsync<JsonElement>("/api/session");
        Assert.Equal(JsonValueKind.Null, session.GetProperty("user").ValueKind);
    }

    [Fact]
    public async Task ProvidersSecondStepCountsOnlyWhenTheInstanceTrustsIt()
    {
        await SetRequirementAsync(MfaRequirements.Everyone);
        try
        {
            foreach (var trusted in new[] { false, true })
            {
                using var provider = new FakeProvider { Amr = ["pwd", "mfa"], AuthTime = DateTimeOffset.UtcNow };
                using var host = Host(provider, trustProviderMfa: trusted);
                using var client = BrowserClient(host);
                var account = await CreateLinkedAccountAsync(provider);

                // Only a trusted provider is asked to sign the person in again when its session is older.
                using (var redirect = await client.GetAsync("/api/auth/oidc/login?returnUrl=%2F"))
                {
                    var asked = QueryHelpers.ParseQuery(redirect.Headers.Location!.Query);
                    Assert.Equal(trusted ? "300" : "", asked.TryGetValue("max_age", out var maxAge) ? maxAge.ToString() : "");
                }

                using var callback = await SignInThroughProviderAsync(client, provider, "/");

                var session = await client.GetFromJsonAsync<JsonElement>("/api/session");
                if (!trusted)
                {
                    // Untrusted, the provider's own step changes nothing: a method is set up here.
                    Assert.StartsWith("/login?mfa_enrollment=1", callback.Headers.Location!.OriginalString, StringComparison.Ordinal);
                    Assert.Equal(JsonValueKind.Null, session.GetProperty("user").ValueKind);
                    continue;
                }

                Assert.Equal("/", callback.Headers.Location!.OriginalString);
                Assert.Equal(account.Id.ToString(), session.GetProperty("user").GetProperty("id").GetString());
                await using var scope = factory.OpenScope(out var db);
                var stored = await db.UserSessions.SingleAsync(x => x.UserId == account.Id);
                Assert.Equal("provider_mfa", stored.MfaEvidence);
                Assert.NotNull(stored.MfaCompletedAt);
            }

            // Trusted, a sign-in the provider did not confirm with more than a
            // password, or confirmed long ago, still meets the instance's step.
            foreach (var (amr, authTime) in new (string[], DateTimeOffset?)[]
                     {
                         (["pwd"], DateTimeOffset.UtcNow),
                         (["pwd", "mfa"], DateTimeOffset.UtcNow.AddHours(-3)),
                         (["pwd", "mfa"], null),
                     })
            {
                using var plain = new FakeProvider { Amr = amr, AuthTime = authTime };
                using var plainHost = Host(plain, trustProviderMfa: true);
                using var plainClient = BrowserClient(plainHost);
                await CreateLinkedAccountAsync(plain);
                using var plainCallback = await SignInThroughProviderAsync(plainClient, plain, "/");
                Assert.StartsWith("/login?mfa_enrollment=1", plainCallback.Headers.Location!.OriginalString, StringComparison.Ordinal);
            }
        }
        finally
        {
            await SetRequirementAsync(MfaRequirements.Optional);
        }
    }

    [Fact]
    public async Task DesktopSignInWithSeveralProvidersGoesToTheSignInPage()
    {
        using var provider = new FakeProvider();
        using var work = new FakeProvider("https://work-identity.test");
        using var host = Host(provider, work);
        using var desktop = host.CreateClient();

        var (_, _, verificationUrl) = await StartDesktopLoginAsync(desktop);

        Assert.StartsWith("/login?returnUrl=%2Fapi%2Fauth%2Fdesktop%2Fbrowser%2Fverify%2F", verificationUrl, StringComparison.Ordinal);
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

    [Fact]
    public async Task RequiredPolicySendsLinkedAccountToEnrollmentWithoutASession()
    {
        using var provider = new FakeProvider();
        using var host = Host(provider);
        using var client = BrowserClient(host);
        var account = await CreateLinkedAccountAsync(provider);
        await SetRequirementAsync(MfaRequirements.Everyone);
        try
        {
            using var callback = await SignInThroughProviderAsync(client, provider, "/");

            Assert.Equal(HttpStatusCode.Redirect, callback.StatusCode);
            Assert.StartsWith("/login?mfa_enrollment=1", callback.Headers.Location!.OriginalString, StringComparison.Ordinal);
            var session = await client.GetFromJsonAsync<JsonElement>("/api/session");
            Assert.Equal(JsonValueKind.Null, session.GetProperty("user").ValueKind);
            await using var scope = factory.OpenScope(out var db);
            Assert.False(await db.UserSessions.AnyAsync(x => x.UserId == account.Id));
        }
        finally
        {
            await SetRequirementAsync(MfaRequirements.Optional);
        }
    }

    [Fact]
    public async Task RecoveryRequiredBlocksTheOidcPrimaryFlow()
    {
        using var provider = new FakeProvider();
        using var host = Host(provider);
        using var client = BrowserClient(host);
        var account = await CreateLinkedAccountAsync(provider);
        await using (var scope = factory.OpenScope(out var db))
        {
            await db.Users.Where(x => x.Id == account.Id).ExecuteUpdateAsync(
                setters => setters.SetProperty(x => x.SecurityRecoveryRequired, true));
        }

        using var callback = await SignInThroughProviderAsync(client, provider, "/");

        Assert.Equal(HttpStatusCode.Redirect, callback.StatusCode);
        Assert.Equal("/login?security_recovery_required=1", callback.Headers.Location!.OriginalString);
        var session = await client.GetFromJsonAsync<JsonElement>("/api/session");
        Assert.Equal(JsonValueKind.Null, session.GetProperty("user").ValueKind);
        await using (var check = factory.OpenScope(out var checkDb))
        {
            Assert.False(await checkDb.UserSessions.AnyAsync(x => x.UserId == account.Id));
        }

        // The recovery is finished on the sign-in page, which learns the choice
        // made before leaving for the provider.
        using var brief = await SignInThroughProviderAsync(client, provider, "/", keepSignedIn: false);
        Assert.Equal(
            "/login?security_recovery_required=1&keep_signed_in=0",
            brief.Headers.Location!.OriginalString);
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

    [Fact]
    public async Task DesktopLoginCannotBeStartedWithoutAProvider()
    {
        using var client = factory.CreateClient();

        using var response = await client.PostAsync("/api/auth/desktop/browser/start", content: null);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task DesktopLoginPointsTheBrowserAtTheProviderAndBackToItsApproval()
    {
        using var provider = new FakeProvider();
        using var host = Host(provider);
        using var desktop = host.CreateClient();

        var handle = await StartDesktopLoginAsync(desktop);

        var verification = new Uri(new Uri("https://localhost"), handle.VerificationUrl);
        Assert.Equal("/api/auth/oidc/login", verification.AbsolutePath);
        Assert.Equal(
            $"/api/auth/desktop/browser/verify/{handle.RequestId}",
            QueryHelpers.ParseQuery(verification.Query)["returnUrl"].ToString());
    }

    [Fact]
    public async Task ApprovalNeedsABrowserThatIsSignedIn()
    {
        using var provider = new FakeProvider();
        using var host = Host(provider);
        using var desktop = host.CreateClient();
        var handle = await StartDesktopLoginAsync(desktop);
        using var browser = BrowserClient(host);

        using var response = await browser.GetAsync($"/api/auth/desktop/browser/verify/{handle.RequestId}");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task UnknownAndExpiredRequestsGetTheExpiredPageAndCannotBeExchanged()
    {
        using var provider = new FakeProvider();
        using var host = Host(provider);
        using var desktop = host.CreateClient();
        using var browser = BrowserClient(host);
        await CreateLinkedAccountAsync(provider);
        (await SignInThroughProviderAsync(browser, provider, "/")).Dispose();
        var handle = await StartDesktopLoginAsync(desktop);
        await using (var scope = factory.OpenScope(out var db))
        {
            await db.DesktopBrowserLogins.Where(x => x.Id == handle.RequestId)
                .ExecuteUpdateAsync(s => s.SetProperty(x => x.ExpiresAt, DateTime.UtcNow.AddSeconds(-1)));
        }

        foreach (var requestId in new[] { Guid.NewGuid(), handle.RequestId })
        {
            using var page = await browser.GetAsync($"/api/auth/desktop/browser/verify/{requestId}");
            Assert.Equal(HttpStatusCode.Gone, page.StatusCode);
            Assert.Contains("Link wygasł", await page.Content.ReadAsStringAsync());
        }

        using var exchange = await desktop.PostAsJsonAsync(
            "/api/auth/desktop/browser/exchange",
            new { requestId = handle.RequestId, secret = handle.Secret });
        Assert.Equal(HttpStatusCode.BadRequest, exchange.StatusCode);
    }

    [Fact]
    public async Task ExchangeWithoutAValidRequestIdIsRejected()
    {
        using var provider = new FakeProvider();
        using var host = Host(provider);
        using var desktop = host.CreateClient();

        using var response = await desktop.PostAsJsonAsync(
            "/api/auth/desktop/browser/exchange",
            new { requestId = "not-a-guid", secret = new string('x', 43) });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task RequestApprovedByOneAccountCannotBeTakenOverByAnother()
    {
        using var provider = new FakeProvider();
        using var host = Host(provider);
        using var desktop = host.CreateClient();
        var handle = await StartDesktopLoginAsync(desktop);
        var approvalUrl = $"/api/auth/desktop/browser/verify/{handle.RequestId}";

        using var first = BrowserClient(host);
        await CreateLinkedAccountAsync(provider);
        (await SignInThroughProviderAsync(first, provider, "/")).Dispose();
        using var form = await first.GetAsync(approvalUrl);
        var token = DesktopBrowserLoginFlowTests.ApprovalToken(await form.Content.ReadAsStringAsync());
        using var approved = await first.PostAsync(
            approvalUrl,
            new FormUrlEncodedContent([new KeyValuePair<string, string>("token", token)]));
        approved.EnsureSuccessStatusCode();

        using var second = BrowserClient(host);
        provider.Subject = $"subject-{Guid.NewGuid():N}";
        await CreateLinkedAccountAsync(provider);
        (await SignInThroughProviderAsync(second, provider, "/")).Dispose();
        using var taken = await second.GetAsync(approvalUrl);

        Assert.Equal(HttpStatusCode.Conflict, taken.StatusCode);
    }

    [Fact]
    public async Task AccountDisabledAfterApprovalIsRefusedAtTheExchange()
    {
        using var provider = new FakeProvider();
        using var host = Host(provider);
        using var desktop = host.CreateClient();
        using var browser = BrowserClient(host);
        var account = await CreateLinkedAccountAsync(provider);
        (await SignInThroughProviderAsync(browser, provider, "/")).Dispose();
        var handle = await StartDesktopLoginAsync(desktop);
        using var form = await browser.GetAsync($"/api/auth/desktop/browser/verify/{handle.RequestId}");
        var token = DesktopBrowserLoginFlowTests.ApprovalToken(await form.Content.ReadAsStringAsync());
        using (var approved = await browser.PostAsync(
                   $"/api/auth/desktop/browser/verify/{handle.RequestId}",
                   new FormUrlEncodedContent([new KeyValuePair<string, string>("token", token)])))
        {
            approved.EnsureSuccessStatusCode();
        }
        await using (var scope = factory.OpenScope(out var db))
        {
            await db.Users.Where(x => x.Id == account.Id)
                .ExecuteUpdateAsync(s => s.SetProperty(x => x.IsDisabled, true));
        }

        using var exchange = await desktop.PostAsJsonAsync(
            "/api/auth/desktop/browser/exchange",
            new { requestId = handle.RequestId, secret = handle.Secret });

        Assert.Equal(HttpStatusCode.Forbidden, exchange.StatusCode);
        var session = await desktop.GetFromJsonAsync<JsonElement>("/api/session");
        Assert.Equal(JsonValueKind.Null, session.GetProperty("user").ValueKind);
    }

    [Fact]
    public async Task StartingALoginClearsOutRequestsThatExpired()
    {
        using var provider = new FakeProvider();
        using var host = Host(provider);
        using var desktop = host.CreateClient();
        var stale = Guid.NewGuid();
        await using (var scope = factory.OpenScope(out var db))
        {
            db.DesktopBrowserLogins.Add(new DesktopBrowserLogin
            {
                Id = stale,
                SecretHash = DataModelSupport.Hash(),
                CreatedAt = DateTime.UtcNow.AddMinutes(-10),
                ExpiresAt = DateTime.UtcNow.AddMinutes(-8),
            });
            await db.SaveChangesAsync();
        }

        var handle = await StartDesktopLoginAsync(desktop);

        await using var check = factory.OpenScope(out var checkDb);
        Assert.False(await checkDb.DesktopBrowserLogins.AnyAsync(x => x.Id == stale));
        Assert.True(await checkDb.DesktopBrowserLogins.AnyAsync(x => x.Id == handle.RequestId));
    }

    /// <summary>The application with the provider configured and its endpoints pointed at <paramref name="provider"/>.</summary>
    /// <summary>The original provider, plus one named "work" when given, each answering through its fake.</summary>
    private WebApplicationFactory<Program> Host(
        FakeProvider provider,
        FakeProvider? work = null,
        bool trustProviderMfa = false) => factory.WithWebHostBuilder(builder =>
    {
        if (work is not null)
        {
            builder.UseSetting("Oidc:Providers:work:Authority", work.IssuerUrl);
            builder.UseSetting("Oidc:Providers:work:ClientId", ClientId);
            builder.UseSetting("Oidc:Providers:work:ClientSecret", "work-client-secret");
            builder.UseSetting("Oidc:Providers:work:DisplayName", "Work");
            builder.ConfigureServices(services => services.PostConfigure<OpenIdConnectOptions>(
                $"{ExternalOidcOptions.AuthenticationScheme}-work",
                options =>
                {
                    options.ConfigurationManager =
                        new StaticConfigurationManager<OpenIdConnectConfiguration>(work.Configuration);
                    options.Backchannel = new HttpClient(work, disposeHandler: false);
                }));
        }

        if (trustProviderMfa)
        {
            builder.UseSetting("Oidc:TrustProviderMfa", "true");
        }

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
        string returnUrl,
        bool? keepSignedIn = null,
        string? providerId = null)
    {
        var keep = keepSignedIn is { } value ? $"&keepSignedIn={(value ? "true" : "false")}" : "";
        var routes = providerId is null ? "/api/auth/oidc" : $"/api/auth/oidc/{providerId}";
        using var login = await client.GetAsync(
            $"{routes}/login?returnUrl={Uri.EscapeDataString(returnUrl)}{keep}");
        Assert.Equal(HttpStatusCode.Redirect, login.StatusCode);
        Assert.StartsWith(provider.IssuerUrl, login.Headers.Location!.AbsoluteUri, StringComparison.Ordinal);
        var query = QueryHelpers.ParseQuery(login.Headers.Location!.Query);
        provider.Nonce = query["nonce"].ToString();

        return await client.GetAsync(
            $"{routes}/callback?code=the-code&state={Uri.EscapeDataString(query["state"].ToString())}");
    }

    private static async Task<(Guid RequestId, string Secret, string VerificationUrl)> StartDesktopLoginAsync(
        HttpClient desktop)
    {
        using var response = await desktop.PostAsync("/api/auth/desktop/browser/start", content: null);
        response.EnsureSuccessStatusCode();
        var handle = await response.Content.ReadFromJsonAsync<JsonElement>();
        return (
            Guid.Parse(handle.GetProperty("requestId").GetString()!),
            handle.GetProperty("secret").GetString()!,
            handle.GetProperty("verificationUrl").GetString()!);
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
            Issuer = provider.IssuerUrl,
            Subject = provider.Subject,
            CreatedAt = DateTime.UtcNow,
        });
        await db.SaveChangesAsync();
        return user;
    }

    private async Task SetRequirementAsync(string requirement)
    {
        await using var scope = factory.OpenScope(out var db);
        var server = await db.Servers.OrderBy(x => x.CreatedAt).FirstAsync();
        var settings = await InstanceSettingsService.LoadAsync(
            db,
            server,
            scope.ServiceProvider.GetRequiredService<IConfiguration>(),
            CancellationToken.None);
        settings.MfaRequirement = requirement;
        settings.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
    }

    private sealed class FakeProvider : HttpMessageHandler
    {
        private readonly RSA _rsa = RSA.Create(2048);
        private readonly RsaSecurityKey _key;

        public FakeProvider(string issuer = Issuer)
        {
            IssuerUrl = issuer;
            _key = new RsaSecurityKey(_rsa) { KeyId = "test-key" };
            Configuration = new OpenIdConnectConfiguration
            {
                Issuer = issuer,
                AuthorizationEndpoint = $"{issuer}/authorize",
                TokenEndpoint = $"{issuer}/token",
            };
            Configuration.SigningKeys.Add(_key);
        }

        public OpenIdConnectConfiguration Configuration { get; }

        public string IssuerUrl { get; }

        /// <summary>How the provider says the person signed in, as the <c>amr</c> claim; none when null.</summary>
        public string[]? Amr { get; set; }

        /// <summary>When the provider says the person signed in, as <c>auth_time</c>; none when null.</summary>
        public DateTimeOffset? AuthTime { get; set; }

        /// <summary>Who the identity token says is signing in. Unique per test, so linked accounts never collide.</summary>
        public string Subject { get; set; } = $"subject-{Guid.NewGuid():N}";

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

            var claims = new Dictionary<string, object> { ["sub"] = Subject, ["nonce"] = Nonce };
            if (Amr is { } amr)
            {
                claims["amr"] = amr;
            }

            if (AuthTime is { } authTime)
            {
                claims["auth_time"] = authTime.ToUnixTimeSeconds();
            }

            var idToken = new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
            {
                Issuer = IssuerUrl,
                Audience = ClientId,
                Expires = DateTime.UtcNow.AddMinutes(5),
                Claims = claims,
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
