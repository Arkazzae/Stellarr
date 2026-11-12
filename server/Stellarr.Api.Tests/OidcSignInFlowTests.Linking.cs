using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Stellarr.Api.Auth;
using Stellarr.Api.Domain;

namespace Stellarr.Api.Tests;

/// <summary>
/// An account linking itself to a provider from its settings. A real
/// provider answers with a cross-site form POST, which the SameSite=Lax
/// session cookie does not ride, so these tests keep cookies by hand and send
/// the provider's answer with the sign-in cookies only.
/// </summary>
public sealed partial class OidcSignInFlowTests
{
    private const string LinkPassword = "Linking!2026";

    [Fact]
    public async Task AccountLinksItselfAndThenSignsInThroughTheProvider()
    {
        using var provider = new FakeProvider();
        using var work = new FakeProvider("https://work-identity.test");
        using var host = Host(provider, work);
        var account = await CreatePasswordAccountAsync();
        var browser = new CookieBrowser(host);
        await browser.SignInAsync(account.Username, LinkPassword);
        var sessionsBefore = await SessionCountAsync(account.Id);

        var result = await browser.LinkAsync(work, "work");

        Assert.Equal("/link-account?result=linked", result.Location);
        Assert.False(result.SetSession);
        Assert.Equal(sessionsBefore, await SessionCountAsync(account.Id));
        await using (var scope = factory.OpenScope(out var db))
        {
            var identity = await db.ExternalIdentities.SingleAsync(x => x.UserId == account.Id);
            Assert.Equal(work.IssuerUrl, identity.Issuer);
            Assert.Equal(work.Subject, identity.Subject);
            Assert.Equal("work", identity.ProviderId);
            Assert.True(await db.SecurityEvents.AnyAsync(
                x => x.UserId == account.Id && x.Kind == SecurityEventKinds.IdentityLinked));
        }

        var security = await browser.GetJsonAsync("/api/me/security");
        Assert.Equal("Work", security.GetProperty("identities")[0].GetProperty("name").GetString());

        using var client = BrowserClient(host);
        using var callback = await SignInThroughProviderAsync(client, work, "/", providerId: "work");
        var session = await client.GetFromJsonAsync<JsonElement>("/api/session");
        Assert.Equal(account.Id.ToString(), session.GetProperty("user").GetProperty("id").GetString());
    }

    [Fact]
    public async Task LinkingNeedsAFreshProof()
    {
        using var provider = new FakeProvider();
        using var host = Host(provider);
        var account = await CreatePasswordAccountAsync();
        var browser = new CookieBrowser(host);
        await browser.SignInAsync(account.Username, LinkPassword);
        await using (var scope = factory.OpenScope(out var db))
        {
            var longAgo = DateTime.UtcNow.AddHours(-1);
            await db.UserSessions.Where(x => x.UserId == account.Id)
                .ExecuteUpdateAsync(setters => setters
                    .SetProperty(x => x.AuthenticatedAt, longAgo)
                    .SetProperty(x => x.CreatedAt, longAgo));
        }

        using var stale = await browser.PostJsonAsync("/api/me/security/identities/default/link", new { });
        using var wrong = await browser.PostJsonAsync("/api/me/security/identities/default/link", new { password = "nope" });
        using var proven = await browser.PostJsonAsync("/api/me/security/identities/default/link", new { password = LinkPassword });

        Assert.Equal(HttpStatusCode.Forbidden, stale.StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, wrong.StatusCode);
        Assert.Equal(HttpStatusCode.OK, proven.StatusCode);
    }

    [Fact]
    public async Task TicketWorksOnlyForItsOwnSessionAndProvider()
    {
        using var provider = new FakeProvider();
        using var work = new FakeProvider("https://work-identity.test");
        using var host = Host(provider, work);
        var account = await CreatePasswordAccountAsync();
        var first = new CookieBrowser(host);
        var second = new CookieBrowser(host);
        await first.SignInAsync(account.Username, LinkPassword);
        await second.SignInAsync(account.Username, LinkPassword);
        var url = await first.LinkUrlAsync("work");

        using var otherSession = await second.GetAsync(url);
        using var otherProvider = await first.GetAsync(url.Replace("/oidc/work/link", "/oidc/link", StringComparison.Ordinal));
        using var signedOut = await new CookieBrowser(host).GetAsync(url);

        foreach (var refused in new[] { otherSession, otherProvider, signedOut })
        {
            Assert.Equal(HttpStatusCode.Redirect, refused.StatusCode);
            Assert.Equal("/link-account?result=failed", refused.Headers.Location!.OriginalString);
        }
    }

    [Fact]
    public async Task SessionEndedBeforeTheProviderAnswersLinksNothing()
    {
        using var provider = new FakeProvider();
        using var host = Host(provider);
        var account = await CreatePasswordAccountAsync();
        var browser = new CookieBrowser(host);
        await browser.SignInAsync(account.Username, LinkPassword);

        var result = await browser.LinkAsync(provider, "default", beforeAnswer: async () =>
        {
            await using var scope = factory.OpenScope(out var db);
            await db.UserSessions.Where(x => x.UserId == account.Id)
                .ExecuteUpdateAsync(setters => setters.SetProperty(x => x.RevokedAt, DateTime.UtcNow));
        });

        Assert.Equal("/link-account?result=failed", result.Location);
        await using var check = factory.OpenScope(out var checkDb);
        Assert.False(await checkDb.ExternalIdentities.AnyAsync(x => x.UserId == account.Id));
    }

    [Fact]
    public async Task IdentityOfAnotherAccountIsNotTakenOver()
    {
        using var provider = new FakeProvider();
        using var host = Host(provider);
        var owner = await CreateLinkedAccountAsync(provider);
        var account = await CreatePasswordAccountAsync();
        var browser = new CookieBrowser(host);
        await browser.SignInAsync(account.Username, LinkPassword);

        var result = await browser.LinkAsync(provider, "default");

        Assert.Equal("/link-account?result=taken", result.Location);
        await using var scope = factory.OpenScope(out var db);
        Assert.Equal(owner.Id, (await db.ExternalIdentities.SingleAsync(x => x.Subject == provider.Subject)).UserId);
        Assert.False(await db.ExternalIdentities.AnyAsync(x => x.UserId == account.Id));
    }

    [Fact]
    public async Task UnlinkedIdentityNoLongerSignsIn()
    {
        using var provider = new FakeProvider();
        using var host = Host(provider);
        var account = await CreatePasswordAccountAsync();
        var browser = new CookieBrowser(host);
        await browser.SignInAsync(account.Username, LinkPassword);
        Assert.Equal("/link-account?result=linked", (await browser.LinkAsync(provider, "default")).Location);
        var identityId = (await browser.GetJsonAsync("/api/me/security"))
            .GetProperty("identities")[0].GetProperty("id").GetString();

        using var unlink = await browser.PostJsonAsync($"/api/me/security/identities/{identityId}/remove", new { });

        Assert.Equal(HttpStatusCode.NoContent, unlink.StatusCode);
        using var client = BrowserClient(host);
        using var callback = await SignInThroughProviderAsync(client, provider, "/");
        Assert.Equal("/login?oidc_error=not_linked", callback.Headers.Location!.OriginalString);
    }

    private async Task<User> CreatePasswordAccountAsync()
    {
        await using var scope = factory.OpenScope(out var db);
        var user = (await DataModelSupport.AddUsersAsync(db, 1))[0];
        user.PasswordHash = scope.ServiceProvider.GetRequiredService<PasswordService>().Hash(LinkPassword);
        await db.SaveChangesAsync();
        return user;
    }

    private async Task<int> SessionCountAsync(Guid userId)
    {
        await using var scope = factory.OpenScope(out var db);
        return await db.UserSessions.CountAsync(x => x.UserId == userId);
    }

    private sealed record LinkResult(string Location, bool SetSession);

    /// <summary>A browser whose cookies the test keeps, so it can leave the session cookie out of a cross-site answer.</summary>
    private sealed class CookieBrowser(Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactory<Program> host)
    {
        private readonly HttpClient _client = host.CreateClient(new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            HandleCookies = false,
            BaseAddress = new Uri("https://localhost"),
        });

        private readonly Dictionary<string, string> _cookies = new(StringComparer.Ordinal);

        public async Task SignInAsync(string username, string password)
        {
            using var login = await PostJsonAsync("/api/auth/login", new { username, password });
            login.EnsureSuccessStatusCode();
        }

        public async Task<string> LinkUrlAsync(string providerId)
        {
            using var start = await PostJsonAsync($"/api/me/security/identities/{providerId}/link", new { });
            start.EnsureSuccessStatusCode();
            return (await start.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("url").GetString()!;
        }

        public async Task<LinkResult> LinkAsync(FakeProvider provider, string providerId, Func<Task>? beforeAnswer = null)
        {
            using var challenge = await GetAsync(await LinkUrlAsync(providerId));
            Assert.Equal(HttpStatusCode.Redirect, challenge.StatusCode);
            var authorize = challenge.Headers.Location!;
            Assert.StartsWith(provider.IssuerUrl, authorize.AbsoluteUri, StringComparison.Ordinal);
            var query = QueryHelpers.ParseQuery(authorize.Query);
            provider.Nonce = query["nonce"].ToString();
            if (beforeAnswer is not null)
            {
                await beforeAnswer();
            }

            var callback = providerId == "default" ? "/api/auth/oidc/callback" : $"/api/auth/oidc/{providerId}/callback";
            using var answer = new HttpRequestMessage(HttpMethod.Post, callback)
            {
                Content = new FormUrlEncodedContent(
                [
                    new KeyValuePair<string, string>("code", "the-code"),
                    new KeyValuePair<string, string>("state", query["state"].ToString()),
                ]),
            };
            // What a cross-site POST carries: the sign-in's own cookies, not the session.
            AddCookies(answer, name => !name.EndsWith("-session", StringComparison.Ordinal));
            using var response = await _client.SendAsync(answer);
            Assert.Equal(HttpStatusCode.Redirect, response.StatusCode);
            var setSession = response.Headers.TryGetValues("Set-Cookie", out var set) &&
                set.Any(x => x.Split('=', 2)[0].EndsWith("-session", StringComparison.Ordinal));
            return new LinkResult(response.Headers.Location!.OriginalString, setSession);
        }

        public async Task<HttpResponseMessage> GetAsync(string url)
        {
            var request = new HttpRequestMessage(HttpMethod.Get, url);
            AddCookies(request, _ => true);
            var response = await _client.SendAsync(request);
            Keep(response);
            return response;
        }

        public async Task<JsonElement> GetJsonAsync(string url)
        {
            using var response = await GetAsync(url);
            response.EnsureSuccessStatusCode();
            return await response.Content.ReadFromJsonAsync<JsonElement>();
        }

        public async Task<HttpResponseMessage> PostJsonAsync(string url, object body)
        {
            var request = new HttpRequestMessage(HttpMethod.Post, url) { Content = JsonContent.Create(body) };
            AddCookies(request, _ => true);
            var response = await _client.SendAsync(request);
            Keep(response);
            return response;
        }

        private void AddCookies(HttpRequestMessage request, Func<string, bool> include)
        {
            var sent = _cookies.Where(x => include(x.Key)).Select(x => $"{x.Key}={x.Value}").ToArray();
            if (sent.Length > 0)
            {
                request.Headers.Add("Cookie", string.Join("; ", sent));
            }
        }

        private void Keep(HttpResponseMessage response)
        {
            if (!response.Headers.TryGetValues("Set-Cookie", out var headers))
            {
                return;
            }

            foreach (var header in headers)
            {
                var pair = header.Split(';', 2)[0].Split('=', 2);
                if (pair.Length == 2)
                {
                    _cookies[pair[0]] = pair[1];
                }
            }
        }
    }
}
