using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Stellarr.Api.Auth;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;

namespace Stellarr.Api.Tests;

public sealed class RegistrationFlowTests
{
    private const string Password = "Production!2026";
    private const string InviteRequired = "Do utworzenia konta na istniejącej instancji wymagane jest zaproszenie.";
    private const string InviteUnusable = "Zaproszenie wygasło, osiągnęło limit użyć albo jest nieprawidłowe.";

    [Fact]
    public async Task FirstRegistrationFoundsTheInstanceAndSignsTheCallerIn()
    {
        using var factory = new StellarrWebApplicationFactory(loadTestData: false);
        using var client = NewClient(factory);

        using var response = await Register(client, "owner", "First Owner", "owner@example.test");

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var created = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("owner", created.GetProperty("username").GetString());
        Assert.Equal("First Owner", created.GetProperty("displayName").GetString());
        Assert.Equal("online", created.GetProperty("presence").GetString());
        Assert.False(created.TryGetProperty("passwordHash", out _));

        var session = await client.GetFromJsonAsync<JsonElement>("/api/session");
        Assert.Equal("owner", session.GetProperty("user").GetProperty("username").GetString());

        await using var scope = factory.OpenScope(out var db);
        var server = await db.Servers.SingleAsync();
        Assert.Equal("Stellarr", server.Name);
        Assert.Equal(
            ["Właściciel", "Członek"],
            await db.ServerRoles.OrderBy(x => x.Position).Select(x => x.Name).ToArrayAsync());
        var channels = await db.Channels.OrderBy(x => x.Position).ToArrayAsync();
        Assert.Equal(
            [("ogólny", ChannelKind.Text), ("rozmowa", ChannelKind.Voice)],
            channels.Select(x => (x.Name, x.Kind)).ToArray());
        Assert.Equal(1, await db.ServerAdminSettings.CountAsync(x => x.ServerId == server.Id));

        var membership = await db.ServerMembers.Include(x => x.Role).SingleAsync();
        Assert.Equal(1, membership.OwnerSlot);
        Assert.True(membership.Role.IsOwner);
        Assert.Equal(ServerPrivileges.All, membership.Role.Permissions);

        var welcome = await db.Messages.SingleAsync();
        Assert.True(welcome.IsSystem);
        Assert.Equal(channels[0].Id, welcome.ChannelId);
        Assert.Equal("<b>First Owner</b> dołącza do serwera. Przywitajcie się!", welcome.Content);
        Assert.Equal(1, await db.UserSessions.CountAsync(x => x.UserId == membership.UserId));
    }

    [Fact]
    public async Task RegisteredAccountSignsInWithItsEmailAndKeepsOnlyAHashOfThePassword()
    {
        using var factory = new StellarrWebApplicationFactory(loadTestData: false);
        using var client = NewClient(factory);
        (await Register(client, "owner", "Owner", "Owner@Example.test")).EnsureSuccessStatusCode();

        using var other = NewClient(factory);
        using var login = await other.PostAsJsonAsync(
            "/api/auth/login",
            new { username = "owner@example.test", password = Password });
        login.EnsureSuccessStatusCode();

        await using var scope = factory.OpenScope(out var db);
        var user = await db.Users.SingleAsync();
        Assert.Equal("Owner@Example.test", user.Email);
        Assert.NotEqual(Password, user.PasswordHash);
        Assert.True(scope.ServiceProvider.GetRequiredService<PasswordService>().Verify(Password, user.PasswordHash));
    }

    [Fact]
    public async Task LaterRegistrationWithoutAnInviteIsRefused()
    {
        using var factory = new StellarrWebApplicationFactory(loadTestData: false);
        using var first = NewClient(factory);
        (await Register(first, "owner", "Owner", "owner@example.test")).EnsureSuccessStatusCode();
        using var second = NewClient(factory);

        using var response = await Register(second, "second", "Second", "second@example.test");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(new Dictionary<string, string[]> { ["inviteCode"] = [InviteRequired] }, await ErrorsOf(response));
        await using var scope = factory.OpenScope(out var db);
        Assert.Equal(1, await db.Users.CountAsync());
        Assert.Equal(1, await db.ServerMembers.CountAsync());
    }

    [Theory]
    [InlineData("ab", "Name", "a@example.test", Password, "username", "Nazwa użytkownika musi mieć 3–32 znaki: litery, cyfry, kropkę, myślnik lub podkreślenie.")]
    [InlineData("a-very-long-username-of-33-chars-xx", "Name", "a@example.test", Password, "username", "Nazwa użytkownika musi mieć 3–32 znaki: litery, cyfry, kropkę, myślnik lub podkreślenie.")]
    [InlineData("with space", "Name", "a@example.test", Password, "username", "Nazwa użytkownika musi mieć 3–32 znaki: litery, cyfry, kropkę, myślnik lub podkreślenie.")]
    [InlineData("valid.name", "   ", "a@example.test", Password, "displayName", "Nazwa widoczna musi mieć od 1 do 64 znaków.")]
    [InlineData("valid.name", "x1234567890123456789012345678901234567890123456789012345678901234", "a@example.test", Password, "displayName", "Nazwa widoczna musi mieć od 1 do 64 znaków.")]
    [InlineData("valid.name", "Name", "not-an-email", Password, "email", "Podaj poprawny adres e-mail.")]
    [InlineData("valid.name", "Name", "Ala <ala@example.test>", Password, "email", "Podaj poprawny adres e-mail.")]
    [InlineData("valid.name", "Name", "", Password, "email", "Podaj poprawny adres e-mail.")]
    [InlineData("valid.name", "Name", "a@example.test", "short12", "password", "Hasło musi mieć co najmniej 8 znaków.")]
    public async Task InvalidFieldsAreAnsweredWithTheirOwnMessage(
        string username, string displayName, string email, string password, string field, string message)
    {
        using var factory = new StellarrWebApplicationFactory(loadTestData: false);
        using var client = NewClient(factory);

        using var response = await Register(client, username, displayName, email, password);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(new Dictionary<string, string[]> { [field] = [message] }, await ErrorsOf(response));
        await using var scope = factory.OpenScope(out var db);
        Assert.False(await db.Users.AnyAsync());
    }

    [Fact]
    public async Task PasswordLongerThanTheLimitIsRefused()
    {
        using var factory = new StellarrWebApplicationFactory(loadTestData: false);
        using var client = NewClient(factory);

        using var response = await Register(client, "owner", "Owner", "owner@example.test", new string('p', 257));

        Assert.Equal(
            new Dictionary<string, string[]> { ["password"] = ["Hasło może mieć najwyżej 256 znaków."] },
            await ErrorsOf(response));
        using var accepted = await Register(client, "owner", "Owner", "owner@example.test", new string('p', 256));
        Assert.Equal(HttpStatusCode.Created, accepted.StatusCode);
    }

    [Fact]
    public async Task EveryInvalidFieldIsReportedAtOnce()
    {
        using var factory = new StellarrWebApplicationFactory(loadTestData: false);
        using var client = NewClient(factory);

        using var response = await Register(client, "x", "", "nope", "1");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(
            ["displayName", "email", "password", "username"],
            (await ErrorsOf(response)).Keys.Order(StringComparer.Ordinal).ToArray());
    }

    [Fact]
    public async Task UsernameAndEmailAreUniqueWhateverTheLetterCase()
    {
        using var factory = new StellarrWebApplicationFactory();
        var code = await AddInviteAsync(factory);
        using var client = NewClient(factory);
        (await Register(client, "Nowa.Osoba", "Nowa", "Nowa@Example.test", inviteCode: code)).EnsureSuccessStatusCode();

        using var sameName = await Register(NewClient(factory), "NOWA.OSOBA", "Inna", "inna@example.test", inviteCode: code);
        using var sameEmail = await Register(NewClient(factory), "inna", "Inna", "nowa@EXAMPLE.test", inviteCode: code);
        using var both = await Register(NewClient(factory), "nowa.osoba", "Inna", "NOWA@example.test", inviteCode: code);
        using var seededName = await Register(NewClient(factory), "MAJA", "Inna", "maja@example.test", inviteCode: code);

        Assert.Equal(HttpStatusCode.BadRequest, sameName.StatusCode);
        Assert.Equal(
            new Dictionary<string, string[]> { ["username"] = ["Ta nazwa użytkownika jest już zajęta."] },
            await ErrorsOf(sameName));
        Assert.Equal(
            new Dictionary<string, string[]> { ["email"] = ["Konto z tym adresem e-mail już istnieje."] },
            await ErrorsOf(sameEmail));
        Assert.Equal(["email", "username"], (await ErrorsOf(both)).Keys.Order(StringComparer.Ordinal).ToArray());
        Assert.Equal(["username"], (await ErrorsOf(seededName)).Keys.ToArray());
        await using var scope = factory.OpenScope(out var db);
        Assert.Equal(6, await db.Users.CountAsync());
    }

    [Fact]
    public async Task InviteAddsTheAccountToTheInvitedServerAsAMember()
    {
        using var factory = new StellarrWebApplicationFactory();
        var code = await AddInviteAsync(factory, maxUses: 2, uses: 1);
        using var client = NewClient(factory);

        using var response = await Register(client, "invited", "Invited <b>Person</b>", "invited@example.test", inviteCode: $"  {code.ToUpperInvariant()} ");

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        await using var scope = factory.OpenScope(out var db);
        var user = await db.Users.SingleAsync(x => x.Username == "invited");
        var membership = await db.ServerMembers.Include(x => x.Role).SingleAsync(x => x.UserId == user.Id);
        Assert.Equal(TestData.ServerId, membership.ServerId);
        Assert.Equal("Członek", membership.Role.Name);
        Assert.False(membership.Role.IsOwner);
        Assert.Null(membership.OwnerSlot);
        Assert.Equal(2, await db.ServerInvites.Where(x => x.Code == code).Select(x => x.Uses).SingleAsync());

        var welcome = await db.Messages.SingleAsync(x => x.AuthorId == user.Id);
        Assert.True(welcome.IsSystem);
        Assert.Equal(TestData.GeneralChannelId, welcome.ChannelId);
        Assert.Equal("<b>Invited ‹b›Person‹/b›</b> dołącza do serwera. Przywitajcie się!", welcome.Content);
        Assert.Equal(1, await db.Servers.CountAsync());

        var session = await client.GetFromJsonAsync<JsonElement>("/api/session");
        Assert.Equal("invited", session.GetProperty("user").GetProperty("username").GetString());
    }

    [Theory]
    [InlineData("unknown")]
    [InlineData("expired")]
    [InlineData("exhausted")]
    public async Task InviteThatCannotBeUsedCreatesNoAccount(string kind)
    {
        using var factory = new StellarrWebApplicationFactory();
        var code = kind switch
        {
            "expired" => await AddInviteAsync(factory, expiresAt: DateTime.UtcNow.AddMinutes(-1)),
            "exhausted" => await AddInviteAsync(factory, maxUses: 3, uses: 3),
            _ => "no-such-code",
        };
        using var client = NewClient(factory);

        using var response = await Register(client, "rejected", "Rejected", "rejected@example.test", inviteCode: code);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(new Dictionary<string, string[]> { ["inviteCode"] = [InviteUnusable] }, await ErrorsOf(response));
        await using var scope = factory.OpenScope(out var db);
        Assert.False(await db.Users.AnyAsync(x => x.Username == "rejected"));
        Assert.Equal(
            kind == "exhausted" ? 3 : 0,
            await db.ServerInvites.Where(x => x.Code == code).Select(x => x.Uses).SingleOrDefaultAsync());
    }

    [Fact]
    public async Task WelcomeNoticeReachesMembersWhoAreOnline()
    {
        using var factory = new StellarrWebApplicationFactory();
        var code = await AddInviteAsync(factory);
        using var login = factory.CreateClient(
            new WebApplicationFactoryClientOptions { AllowAutoRedirect = false, HandleCookies = false });
        using var signedIn = await login.PostAsJsonAsync("/api/auth/login", new { username = "maja", password = "Aurora!2026" });
        var cookie = string.Join("; ", signedIn.Headers.GetValues("Set-Cookie").Select(x => x.Split(';', 2)[0]));

        await using var hub = new HubConnectionBuilder()
            .WithUrl("https://localhost/hubs/app", options =>
            {
                options.Headers["Cookie"] = cookie;
                options.Transports = HttpTransportType.LongPolling;
                options.HttpMessageHandlerFactory = _ => factory.Server.CreateHandler();
            })
            .Build();
        var connected = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var notice = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
        // The hub's first message to a connection comes after it joined its groups.
        hub.On<JsonElement>("PresenceChanged", _ => connected.TrySetResult());
        hub.On<JsonElement>("MessageCreated", payload => notice.TrySetResult(payload.Clone()));
        await hub.StartAsync();
        await connected.Task.WaitAsync(TimeSpan.FromSeconds(10));

        using var client = NewClient(factory);
        (await Register(client, "newcomer", "Newcomer", "newcomer@example.test", inviteCode: code)).EnsureSuccessStatusCode();

        var message = await notice.Task.WaitAsync(TimeSpan.FromSeconds(10));
        Assert.Equal("system", message.GetProperty("author").GetProperty("id").GetString());
        Assert.Equal(TestData.GeneralChannelId.ToString(), message.GetProperty("channelId").GetString());
        Assert.Equal(
            "<b>Newcomer</b> dołącza do serwera. Przywitajcie się!",
            message.GetProperty("content").GetString());
    }

    [Fact]
    public async Task SimultaneousFirstRegistrationsFoundOneInstanceBetweenThem()
    {
        using var factory = new StellarrWebApplicationFactory(loadTestData: false);
        using var first = NewClient(factory);
        using var second = NewClient(factory);

        var responses = await Task.WhenAll(
            Register(first, "first-owner", "First", "first@example.test"),
            Register(second, "second-owner", "Second", "second@example.test"));

        Assert.Equal(
            [HttpStatusCode.Created, HttpStatusCode.BadRequest],
            responses.Select(x => x.StatusCode).Order().ToArray());
        await using var scope = factory.OpenScope(out var db);
        Assert.Equal(1, await db.Servers.CountAsync());
        Assert.Equal(1, await db.ServerMembers.CountAsync(x => x.OwnerSlot == 1));
        Assert.Equal(1, await db.ServerMembers.CountAsync());
    }

    [Fact]
    public async Task SimultaneousRegistrationsOfOneAccountAnswerCreatedAndValidation()
    {
        using var factory = new StellarrWebApplicationFactory();
        var code = await AddInviteAsync(factory);
        using var first = NewClient(factory);
        using var second = NewClient(factory);

        var responses = await Task.WhenAll(
            Register(first, "twice", "Twice", "twice@example.test", inviteCode: code),
            Register(second, "twice", "Twice", "twice@example.test", inviteCode: code));

        Assert.Equal(
            [HttpStatusCode.Created, HttpStatusCode.BadRequest],
            responses.Select(x => x.StatusCode).Order().ToArray());
        await using var scope = factory.OpenScope(out var db);
        Assert.Equal(1, await db.Users.CountAsync(x => x.Username == "twice"));
        Assert.Equal(1, await db.ServerInvites.Where(x => x.Code == code).Select(x => x.Uses).SingleAsync());
    }

    [Fact]
    public async Task RegistrationAttemptsAreLimitedPerAddress()
    {
        // The limits are lifted in the Testing environment, so this host runs
        // as development, where they come from configuration.
        using var factory = new StellarrWebApplicationFactory();
        using var limited = factory.WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Development");
            builder.UseSetting("RateLimiting:AuthWrite:PermitLimit", "2");
        });
        using var client = limited.CreateClient();

        var statuses = new List<HttpStatusCode>();
        for (var attempt = 0; attempt < 3; attempt++)
        {
            using var response = await Register(client, "x", "", "nope", "1");
            statuses.Add(response.StatusCode);
        }

        Assert.Equal([HttpStatusCode.BadRequest, HttpStatusCode.BadRequest, HttpStatusCode.TooManyRequests], statuses);
    }

    private static HttpClient NewClient(StellarrWebApplicationFactory factory) =>
        factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false, HandleCookies = true });

    private static Task<HttpResponseMessage> Register(
        HttpClient client,
        string username,
        string displayName,
        string email,
        string password = Password,
        string? inviteCode = null) =>
        client.PostAsJsonAsync("/api/auth/register", new { username, displayName, email, password, inviteCode });

    private static async Task<Dictionary<string, string[]>> ErrorsOf(HttpResponseMessage response)
    {
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>();
        return problem.GetProperty("errors").EnumerateObject().ToDictionary(
            x => x.Name,
            x => x.Value.EnumerateArray().Select(message => message.GetString()!).ToArray());
    }

    /// <summary>Stores an invite to the seeded server and returns its code.</summary>
    private static async Task<string> AddInviteAsync(
        StellarrWebApplicationFactory factory,
        int? maxUses = null,
        int uses = 0,
        DateTime? expiresAt = null)
    {
        await using var scope = factory.OpenScope(out var db);
        var code = $"invite{Guid.NewGuid():N}"[..16];
        db.ServerInvites.Add(new ServerInvite
        {
            Id = Guid.NewGuid(),
            ServerId = TestData.ServerId,
            CreatedById = Guid.Parse("30000000-0000-0000-0000-000000000001"),
            Code = code,
            Uses = uses,
            MaxUses = maxUses,
            ExpiresAt = expiresAt,
            CreatedAt = DateTime.UtcNow,
        });
        await db.SaveChangesAsync();
        return code;
    }
}
