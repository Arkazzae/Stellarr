using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;

namespace Stellarr.Api.Tests;

public sealed class CockpitAccessTests : IClassFixture<StellarrWebApplicationFactory>
{
    private const string OwnerPassword = "Aurora!2026";
    private const string NewPassword = "Nowe-haslo-2026";

    private static readonly string[] MessagePermissions = ["manageMessages"];
    private static readonly string[] AdminPermissions = ["manageRoles", "viewAuditLog"];
    private static readonly string[] UnknownPermissions = ["fly"];

    private readonly StellarrWebApplicationFactory _factory;

    public CockpitAccessTests(StellarrWebApplicationFactory factory) => _factory = factory;

    [Theory]
    [InlineData("/api/cockpit/bootstrap")]
    [InlineData("/api/cockpit/users")]
    [InlineData("/api/cockpit/sessions")]
    public async Task OnlyTheInstanceOwnerCanOpenThePanel(string path)
    {
        using var anonymous = Client();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync(path)).StatusCode);

        using var moderator = Client();
        await LoginAsync(moderator, "ada", "Quasar!2026");
        Assert.Equal(HttpStatusCode.Forbidden, (await moderator.GetAsync(path)).StatusCode);

        using var member = Client();
        await LoginAsync(member, "jo", "Corona!2026");
        Assert.Equal(HttpStatusCode.Forbidden, (await member.GetAsync(path)).StatusCode);
        (await member.PostAsJsonAsync("/api/servers", new
        {
            name = $"Own server {Guid.NewGuid():N}",
            description = "owning it grants nothing on the instance",
            isPublic = false,
        })).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Forbidden, (await member.GetAsync(path)).StatusCode);
    }

    [Fact]
    public async Task OwnerCreatesAnAccountThatCanSignIn()
    {
        using var owner = await OwnerAsync();
        var username = Unique("nowy");

        var created = await owner.PostAsJsonAsync("/api/cockpit/users", NewUser(username, await MemberRoleIdAsync(owner)));
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);

        using var newcomer = Client();
        await LoginAsync(newcomer, username, NewPassword);
        var users = await JsonAsync(await owner.GetAsync("/api/cockpit/users"));
        var listed = users.GetProperty("users").EnumerateArray()
            .Single(user => user.GetProperty("username").GetString() == username);
        Assert.Equal("Członek", listed.GetProperty("roleName").GetString());
        Assert.False(listed.GetProperty("isDisabled").GetBoolean());

        await using var scope = _factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.Contains(
            await db.ServerAuditEntries.AsNoTracking().Select(x => x.Summary).ToArrayAsync(),
            summary => summary == "Maja utworzył(a) konto Nowa osoba");
    }

    [Fact]
    public async Task OwnerCannotCreateAnAccountThatClashesOrIsInvalid()
    {
        using var owner = await OwnerAsync();
        var roleId = await MemberRoleIdAsync(owner);
        var username = Unique("zajety");
        (await owner.PostAsJsonAsync("/api/cockpit/users", NewUser(username, roleId))).EnsureSuccessStatusCode();

        Assert.Equal(
            HttpStatusCode.Conflict,
            (await owner.PostAsJsonAsync("/api/cockpit/users", NewUser(username.ToUpperInvariant(), roleId))).StatusCode);
        Assert.Equal(
            HttpStatusCode.BadRequest,
            (await owner.PostAsJsonAsync("/api/cockpit/users", NewUser(Unique("krotkie"), roleId) with
            {
                Password = "short",
            })).StatusCode);
        Assert.Equal(
            HttpStatusCode.BadRequest,
            (await owner.PostAsJsonAsync("/api/cockpit/users", NewUser("!?", roleId))).StatusCode);

        var ownerRoleId = await RoleIdAsync(owner, role => role.GetProperty("isOwner").GetBoolean());
        Assert.Equal(
            HttpStatusCode.BadRequest,
            (await owner.PostAsJsonAsync("/api/cockpit/users", NewUser(Unique("wlasc"), ownerRoleId))).StatusCode);
        Assert.Equal(
            HttpStatusCode.BadRequest,
            (await owner.PostAsJsonAsync("/api/cockpit/users", NewUser(Unique("nieznana"), Guid.NewGuid().ToString()))).StatusCode);
    }

    [Fact]
    public async Task OwnerMovesAnotherMemberToAnotherRoleButNotThemselves()
    {
        using var owner = await OwnerAsync();
        var memberRoleId = await MemberRoleIdAsync(owner);
        var moderatorRoleId = await RoleIdAsync(owner, role => role.GetProperty("name").GetString() == "Moderacja");
        var username = Unique("zmiana");
        (await owner.PostAsJsonAsync("/api/cockpit/users", NewUser(username, memberRoleId))).EnsureSuccessStatusCode();
        var userId = await UserIdAsync(owner, username);

        (await owner.PatchAsJsonAsync($"/api/cockpit/users/{userId}/role", new { roleId = moderatorRoleId }))
            .EnsureSuccessStatusCode();
        Assert.Equal(moderatorRoleId, await RoleOfAsync(owner, username));

        var ownerId = await UserIdAsync(owner, "maja");
        Assert.Equal(
            HttpStatusCode.Conflict,
            (await owner.PatchAsJsonAsync($"/api/cockpit/users/{ownerId}/role", new { roleId = memberRoleId })).StatusCode);
        var ownerRoleId = await RoleIdAsync(owner, role => role.GetProperty("isOwner").GetBoolean());
        Assert.Equal(
            HttpStatusCode.NotFound,
            (await owner.PatchAsJsonAsync($"/api/cockpit/users/{userId}/role", new { roleId = ownerRoleId })).StatusCode);
        Assert.Equal(
            HttpStatusCode.NotFound,
            (await owner.PatchAsJsonAsync($"/api/cockpit/users/{Guid.NewGuid()}/role", new { roleId = memberRoleId })).StatusCode);
    }

    [Fact]
    public async Task DisablingAnAccountEndsItsSessionsUntilItIsEnabledAgain()
    {
        using var owner = await OwnerAsync();
        var username = Unique("wylacz");
        (await owner.PostAsJsonAsync("/api/cockpit/users", NewUser(username, await MemberRoleIdAsync(owner))))
            .EnsureSuccessStatusCode();
        var userId = await UserIdAsync(owner, username);
        using var signedIn = Client();
        await LoginAsync(signedIn, username, NewPassword);
        Assert.Equal(HttpStatusCode.Forbidden, (await signedIn.GetAsync("/api/cockpit/bootstrap")).StatusCode);

        Assert.Equal(
            HttpStatusCode.NoContent,
            (await owner.PatchAsJsonAsync($"/api/cockpit/users/{userId}/status", new { disabled = true })).StatusCode);

        Assert.Equal(HttpStatusCode.Unauthorized, (await signedIn.GetAsync("/api/cockpit/bootstrap")).StatusCode);
        using var retry = Client();
        Assert.Equal(
            HttpStatusCode.Unauthorized,
            (await retry.PostAsJsonAsync("/api/auth/login", new { username, password = NewPassword })).StatusCode);

        (await owner.PatchAsJsonAsync($"/api/cockpit/users/{userId}/status", new { disabled = false }))
            .EnsureSuccessStatusCode();
        await LoginAsync(retry, username, NewPassword);
    }

    [Fact]
    public async Task OwnerCannotDisableThemselvesOrAStranger()
    {
        using var owner = await OwnerAsync();
        var ownerId = await UserIdAsync(owner, "maja");

        Assert.Equal(
            HttpStatusCode.Conflict,
            (await owner.PatchAsJsonAsync($"/api/cockpit/users/{ownerId}/status", new { disabled = true })).StatusCode);
        Assert.Equal(
            HttpStatusCode.NotFound,
            (await owner.PatchAsJsonAsync($"/api/cockpit/users/{Guid.NewGuid()}/status", new { disabled = true })).StatusCode);
    }

    [Fact]
    public async Task OwnerCreatesAndEditsRoles()
    {
        using var owner = await OwnerAsync();
        var name = Unique("rola");

        var created = await owner.PostAsJsonAsync("/api/cockpit/roles", new
        {
            name,
            color = "#336699",
            permissions = MessagePermissions,
        });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var role = await JsonAsync(created);
        Assert.Equal(0, role.GetProperty("memberCount").GetInt32());
        Assert.Equal("manageMessages", role.GetProperty("permissions")[0].GetString());
        var roleId = role.GetProperty("id").GetString();

        Assert.Equal(
            HttpStatusCode.Conflict,
            (await owner.PostAsJsonAsync("/api/cockpit/roles", new { name, color = "#000000", permissions = Array.Empty<string>() })).StatusCode);
        Assert.Equal(
            HttpStatusCode.BadRequest,
            (await owner.PostAsJsonAsync("/api/cockpit/roles", new { name = Unique("zla"), color = "#000000", permissions = UnknownPermissions })).StatusCode);

        var renamed = Unique("nowa");
        var update = await owner.PatchAsJsonAsync($"/api/cockpit/roles/{roleId}", new
        {
            name = renamed,
            permissions = AdminPermissions,
        });
        update.EnsureSuccessStatusCode();
        var updated = await JsonAsync(update);
        Assert.Equal(renamed, updated.GetProperty("name").GetString());
        Assert.Equal("#336699", updated.GetProperty("color").GetString());
        Assert.Equal(
            AdminPermissions,
            updated.GetProperty("permissions").EnumerateArray().Select(x => x.GetString()).ToArray());

        Assert.Equal(
            HttpStatusCode.NotFound,
            (await owner.PatchAsJsonAsync($"/api/cockpit/roles/{Guid.NewGuid()}", new { name = Unique("brak") })).StatusCode);
        var ownerRoleId = await RoleIdAsync(owner, candidate => candidate.GetProperty("isOwner").GetBoolean());
        Assert.Equal(
            HttpStatusCode.Conflict,
            (await owner.PatchAsJsonAsync($"/api/cockpit/roles/{ownerRoleId}", new { name = Unique("wlasciciel") })).StatusCode);
    }

    [Fact]
    public async Task OwnerRevokesAnotherSessionButNotTheCurrentOne()
    {
        using var owner = await OwnerAsync();
        using var otherDevice = await OwnerAsync();
        var currentId = await CurrentSessionIdAsync(owner);
        var otherId = await CurrentSessionIdAsync(otherDevice);
        Assert.NotEqual(currentId, otherId);

        Assert.Equal(HttpStatusCode.Conflict, (await owner.DeleteAsync($"/api/cockpit/sessions/{currentId}")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await owner.GetAsync("/api/cockpit/bootstrap")).StatusCode);

        Assert.Equal(HttpStatusCode.NoContent, (await owner.DeleteAsync($"/api/cockpit/sessions/{otherId}")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await otherDevice.GetAsync("/api/cockpit/bootstrap")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await owner.DeleteAsync($"/api/cockpit/sessions/{otherId}")).StatusCode);
    }

    [Fact]
    public async Task UpgradeBringsALegacySettingsTableUpToDate()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var client = factory.CreateClient();
        _ = await client.GetAsync("/health/ready");

        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await db.Database.ExecuteSqlRawAsync(
            """
            DROP TABLE "OperationsSettings";
            CREATE TABLE "OperationsSettings" (
                "ServerId" TEXT NOT NULL CONSTRAINT "PK_OperationsSettings" PRIMARY KEY,
                "PublicUrl" TEXT NOT NULL,
                "TimeZone" TEXT NOT NULL,
                "MailingEnabled" INTEGER NOT NULL,
                "MailFromAddress" TEXT NOT NULL,
                "SmtpHost" TEXT NOT NULL,
                "SmtpPort" INTEGER NOT NULL,
                "SmtpUsername" TEXT NOT NULL,
                "SmtpSecurity" TEXT NOT NULL,
                "InviteMailEnabled" INTEGER NOT NULL,
                "RecoveryMailEnabled" INTEGER NOT NULL,
                "AlertMailEnabled" INTEGER NOT NULL,
                "BackupRetentionDays" INTEGER NOT NULL,
                "LogRetentionDays" INTEGER NOT NULL,
                "OrphanObjectRetentionDays" INTEGER NOT NULL,
                "AutomaticCleanupEnabled" INTEGER NOT NULL,
                "UpdatedAt" TEXT NOT NULL,
                CONSTRAINT "FK_OperationsSettings_Servers_ServerId"
                    FOREIGN KEY ("ServerId") REFERENCES "Servers" ("Id") ON DELETE CASCADE
            );
            """);

        await DatabaseSchema.UpgradeAsync(db, default);
        await DatabaseSchema.UpgradeAsync(db, default);

        var columns = await db.Database.SqlQueryRaw<string>(
                "SELECT name AS Value FROM pragma_table_info('OperationsSettings')")
            .ToArrayAsync();
        Assert.DoesNotContain(columns, column => column.StartsWith("Smtp", StringComparison.Ordinal));
        Assert.Contains("DesktopMinimumVersion", columns);
        Assert.Contains("DesktopRecommendedVersion", columns);

        db.OperationsSettings.Add(new OperationsSettings
        {
            ServerId = TestData.ServerId,
            PublicUrl = "https://chat.test",
            DesktopMinimumVersion = "0.2.0",
            UpdatedAt = DateTime.UtcNow,
        });
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();
        Assert.Equal("0.2.0", (await db.OperationsSettings.SingleAsync()).DesktopMinimumVersion);
    }

    private static string Unique(string prefix) => $"{prefix}{Guid.NewGuid():N}"[..16];

    private static NewUserRequest NewUser(string username, string roleId) => new()
    {
        Username = username,
        DisplayName = "Nowa osoba",
        Email = $"{username}@example.net",
        Password = NewPassword,
        RoleId = roleId,
    };

    private sealed record NewUserRequest
    {
        public required string Username { get; init; }
        public required string DisplayName { get; init; }
        public required string Email { get; init; }
        public required string Password { get; init; }
        public required string RoleId { get; init; }
    }

    private static async Task<string> MemberRoleIdAsync(HttpClient owner) =>
        await RoleIdAsync(owner, role =>
            role.GetProperty("isSystem").GetBoolean() && !role.GetProperty("isOwner").GetBoolean());

    private static async Task<string> RoleIdAsync(HttpClient owner, Func<JsonElement, bool> match)
    {
        var users = await JsonAsync(await owner.GetAsync("/api/cockpit/users"));
        return users.GetProperty("roles").EnumerateArray().Single(match).GetProperty("id").GetString()!;
    }

    private static async Task<string> UserIdAsync(HttpClient owner, string username)
    {
        var users = await JsonAsync(await owner.GetAsync("/api/cockpit/users"));
        return users.GetProperty("users").EnumerateArray()
            .Single(user => user.GetProperty("username").GetString() == username)
            .GetProperty("id").GetString()!;
    }

    private static async Task<string> RoleOfAsync(HttpClient owner, string username)
    {
        var users = await JsonAsync(await owner.GetAsync("/api/cockpit/users"));
        return users.GetProperty("users").EnumerateArray()
            .Single(user => user.GetProperty("username").GetString() == username)
            .GetProperty("roleId").GetString()!;
    }

    private static async Task<string> CurrentSessionIdAsync(HttpClient owner)
    {
        var sessions = await JsonAsync(await owner.GetAsync("/api/cockpit/sessions"));
        return sessions.EnumerateArray()
            .Single(session => session.GetProperty("current").GetBoolean())
            .GetProperty("id").GetString()!;
    }

    private async Task<HttpClient> OwnerAsync()
    {
        var client = Client();
        await LoginAsync(client, "maja", OwnerPassword);
        return client;
    }

    private HttpClient Client() => _factory.CreateClient(
        new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            HandleCookies = true,
        });

    private static async Task LoginAsync(HttpClient client, string username, string password) =>
        (await client.PostAsJsonAsync("/api/auth/login", new { username, password }))
            .EnsureSuccessStatusCode();

    private static async Task<JsonElement> JsonAsync(HttpResponseMessage response)
    {
        response.EnsureSuccessStatusCode();
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return document.RootElement.Clone();
    }
}
