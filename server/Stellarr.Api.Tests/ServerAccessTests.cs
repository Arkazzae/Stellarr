using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Auth;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;

namespace Stellarr.Api.Tests;

public sealed class ServerAccessTests(StellarrWebApplicationFactory factory)
    : IClassFixture<StellarrWebApplicationFactory>
{
    private static readonly string[] AllNames =
    [
        "manageServer", "manageChannels", "manageRoles", "manageMembers",
        "manageMessages", "moderateMembers", "manageBans", "viewAuditLog",
    ];

    private static readonly Guid MajaId = Guid.Parse("30000000-0000-0000-0000-000000000001");
    private static readonly Guid AdaId = Guid.Parse("30000000-0000-0000-0000-000000000002");
    private static readonly Guid IlyaId = Guid.Parse("30000000-0000-0000-0000-000000000003");

    [Fact]
    public async Task MembersGetThePrivilegesOfTheirRoleAndStrangersGetNone()
    {
        await using var scope = factory.OpenScope(out var db);
        var stranger = (await DataModelSupport.AddUsersAsync(db, 1))[0];

        Assert.Equal(ServerPrivileges.All, await ServerAccess.GetAsync(db, MajaId, TestData.ServerId));
        Assert.Equal(
            ServerPrivileges.ManageMessages | ServerPrivileges.ModerateMembers | ServerPrivileges.ManageBans,
            await ServerAccess.GetAsync(db, AdaId, TestData.ServerId));
        Assert.Equal(ServerPrivileges.None, await ServerAccess.GetAsync(db, IlyaId, TestData.ServerId));
        Assert.Equal(ServerPrivileges.None, await ServerAccess.GetAsync(db, stranger.Id, TestData.ServerId));

        Assert.True(await ServerAccess.HasAsync(db, AdaId, TestData.ServerId, ServerPrivileges.ManageBans));
        Assert.False(await ServerAccess.HasAsync(
            db, AdaId, TestData.ServerId, ServerPrivileges.ManageBans | ServerPrivileges.ManageServer));
        Assert.False(await ServerAccess.HasAsync(db, stranger.Id, TestData.ServerId, ServerPrivileges.ManageBans));
    }

    [Fact]
    public async Task ChannelWithoutOverridesFollowsTheRole()
    {
        await using var scope = factory.OpenScope(out var db);
        var member = await AddMemberAsync(db, ServerPrivileges.ManageMessages);

        Assert.True(await HasOnChannelAsync(db, member, TestData.GeneralChannelId, ServerPrivileges.ManageMessages));
        Assert.False(await HasOnChannelAsync(db, member, TestData.GeneralChannelId, ServerPrivileges.ManageBans));
    }

    [Fact]
    public async Task ChannelOverrideBeatsSectionOverrideWhichBeatsTheRole()
    {
        await using var scope = factory.OpenScope(out var db);
        var member = await AddMemberAsync(db, ServerPrivileges.ManageMessages);
        var section = await AddSectionAsync(db);
        var denied = await AddChannelAsync(db, section.Id);
        var reallowed = await AddChannelAsync(db, section.Id);
        var outside = await AddChannelAsync(db, null);
        AddOverride(db, PermissionTargetType.Section, section.Id, member.RoleId, deny: ServerPrivileges.ManageMessages);
        AddOverride(db, PermissionTargetType.Channel, reallowed.Id, member.RoleId, allow: ServerPrivileges.ManageMessages);
        await db.SaveChangesAsync();

        Assert.False(await HasOnChannelAsync(db, member, denied.Id, ServerPrivileges.ManageMessages));
        Assert.True(await HasOnChannelAsync(db, member, reallowed.Id, ServerPrivileges.ManageMessages));
        Assert.True(await HasOnChannelAsync(db, member, outside.Id, ServerPrivileges.ManageMessages));
    }

    [Fact]
    public async Task OverridesCanGrantWhatTheRoleLacksAndChannelCanTakeItBack()
    {
        await using var scope = factory.OpenScope(out var db);
        var member = await AddMemberAsync(db, ServerPrivileges.None);
        var section = await AddSectionAsync(db);
        var inherited = await AddChannelAsync(db, section.Id);
        var revoked = await AddChannelAsync(db, section.Id);
        AddOverride(db, PermissionTargetType.Section, section.Id, member.RoleId, allow: ServerPrivileges.ManageChannels);
        AddOverride(db, PermissionTargetType.Channel, revoked.Id, member.RoleId, deny: ServerPrivileges.ManageChannels);
        await db.SaveChangesAsync();

        Assert.True(await HasOnChannelAsync(db, member, inherited.Id, ServerPrivileges.ManageChannels));
        Assert.False(await HasOnChannelAsync(db, member, revoked.Id, ServerPrivileges.ManageChannels));
    }

    [Fact]
    public async Task InsideOneOverrideDenyWinsOverAllow()
    {
        await using var scope = factory.OpenScope(out var db);
        var member = await AddMemberAsync(db, ServerPrivileges.None);
        var channel = await AddChannelAsync(db, null);
        AddOverride(
            db,
            PermissionTargetType.Channel,
            channel.Id,
            member.RoleId,
            allow: ServerPrivileges.ManageBans | ServerPrivileges.ViewAuditLog,
            deny: ServerPrivileges.ManageBans);
        await db.SaveChangesAsync();

        Assert.False(await HasOnChannelAsync(db, member, channel.Id, ServerPrivileges.ManageBans));
        Assert.True(await HasOnChannelAsync(db, member, channel.Id, ServerPrivileges.ViewAuditLog));
    }

    [Fact]
    public async Task OverridesOfOtherRolesDoNotApply()
    {
        await using var scope = factory.OpenScope(out var db);
        var member = await AddMemberAsync(db, ServerPrivileges.None);
        var other = await AddMemberAsync(db, ServerPrivileges.None);
        var channel = await AddChannelAsync(db, null);
        AddOverride(db, PermissionTargetType.Channel, channel.Id, other.RoleId, allow: ServerPrivileges.ManageBans);
        await db.SaveChangesAsync();

        Assert.True(await HasOnChannelAsync(db, other, channel.Id, ServerPrivileges.ManageBans));
        Assert.False(await HasOnChannelAsync(db, member, channel.Id, ServerPrivileges.ManageBans));
    }

    [Fact]
    public async Task ChannelOfAnotherServerNeverGrantsAnything()
    {
        await using var scope = factory.OpenScope(out var db);
        var member = await AddMemberAsync(db, ServerPrivileges.All);
        var otherServer = new StellarrServer { Id = Guid.NewGuid(), Name = DataModelSupport.UniqueName(), CreatedAt = DateTime.UtcNow };
        var foreign = new Channel
        {
            Id = Guid.NewGuid(),
            ServerId = otherServer.Id,
            Name = DataModelSupport.UniqueName(),
            Kind = ChannelKind.Text,
        };
        db.Servers.Add(otherServer);
        db.Channels.Add(foreign);
        await db.SaveChangesAsync();

        Assert.False(await HasOnChannelAsync(db, member, foreign.Id, ServerPrivileges.ManageMessages));
        Assert.False(await HasOnChannelAsync(db, member, Guid.NewGuid(), ServerPrivileges.ManageMessages));
    }

    [Fact]
    public async Task NonMemberHasNoPrivilegeOnAnyChannel()
    {
        await using var scope = factory.OpenScope(out var db);
        var stranger = (await DataModelSupport.AddUsersAsync(db, 1))[0];

        Assert.False(await ServerAccess.HasAsync(
            db, stranger.Id, TestData.ServerId, TestData.GeneralChannelId, ServerPrivileges.ManageMessages));
    }

    [Fact]
    public async Task SectionOverrideDecidesWhatARoleMayDoToTheSection()
    {
        await using var scope = factory.OpenScope(out var db);
        var member = await AddMemberAsync(db, ServerPrivileges.ManageChannels);
        var plain = await AddSectionAsync(db);
        var denied = await AddSectionAsync(db);
        var granted = await AddSectionAsync(db);
        AddOverride(db, PermissionTargetType.Section, denied.Id, member.RoleId, deny: ServerPrivileges.ManageChannels);
        AddOverride(
            db,
            PermissionTargetType.Section,
            granted.Id,
            member.RoleId,
            allow: ServerPrivileges.ManageBans | ServerPrivileges.ManageRoles,
            deny: ServerPrivileges.ManageRoles);
        await db.SaveChangesAsync();

        Assert.True(await HasOnSectionAsync(db, member, plain.Id, ServerPrivileges.ManageChannels));
        Assert.False(await HasOnSectionAsync(db, member, denied.Id, ServerPrivileges.ManageChannels));
        Assert.True(await HasOnSectionAsync(db, member, granted.Id, ServerPrivileges.ManageBans));
        Assert.False(await HasOnSectionAsync(db, member, granted.Id, ServerPrivileges.ManageRoles));
    }

    [Fact]
    public async Task SectionCheckRefusesOtherServersAndStrangers()
    {
        await using var scope = factory.OpenScope(out var db);
        var member = await AddMemberAsync(db, ServerPrivileges.All);
        var stranger = (await DataModelSupport.AddUsersAsync(db, 1))[0];
        var section = await AddSectionAsync(db);
        var otherServer = new StellarrServer { Id = Guid.NewGuid(), Name = DataModelSupport.UniqueName(), CreatedAt = DateTime.UtcNow };
        var foreign = new Section { Id = Guid.NewGuid(), ServerId = otherServer.Id, Name = "obca" };
        db.Servers.Add(otherServer);
        db.Sections.Add(foreign);
        await db.SaveChangesAsync();

        Assert.True(await HasOnSectionAsync(db, member, section.Id, ServerPrivileges.ManageChannels));
        Assert.False(await HasOnSectionAsync(db, member, foreign.Id, ServerPrivileges.ManageChannels));
        Assert.False(await ServerAccess.HasForSectionAsync(
            db, stranger.Id, TestData.ServerId, section.Id, ServerPrivileges.ManageChannels));
    }

    [Fact]
    public void PrivilegesRoundTripThroughTheirCamelCaseNames()
    {
        Assert.Equal(AllNames, ServerAccess.ToNames(ServerPrivileges.All));
        Assert.Empty(ServerAccess.ToNames(ServerPrivileges.None));
        Assert.Equal(
            ["manageRoles", "viewAuditLog"],
            ServerAccess.ToNames(ServerPrivileges.ManageRoles | ServerPrivileges.ViewAuditLog));

        Assert.True(ServerAccess.TryParse(AllNames, out var all));
        Assert.Equal(ServerPrivileges.All, all);
        Assert.True(ServerAccess.TryParse(["manageBans", "manageBans"], out var bans));
        Assert.Equal(ServerPrivileges.ManageBans, bans);
        Assert.True(ServerAccess.TryParse(null, out var none));
        Assert.Equal(ServerPrivileges.None, none);
    }

    [Theory]
    [InlineData("administrator")]
    [InlineData("ManageServer")]
    [InlineData("")]
    public void UnknownPrivilegeNameIsRefusedWithNothingGranted(string name)
    {
        Assert.False(ServerAccess.TryParse(["manageServer", name], out var privileges));
        Assert.Equal(ServerPrivileges.None, privileges);
    }

    [Fact]
    public async Task UpgradeRestoresTheOwnerSlotOfTheOwnerAndOnlyTheOwner()
    {
        using var isolated = new StellarrWebApplicationFactory();
        await using var scope = isolated.OpenScope(out var db);
        await db.ServerMembers.ExecuteUpdateAsync(setters => setters.SetProperty(x => x.OwnerSlot, (int?)null));

        await DatabaseSchema.UpgradeAsync(db, CancellationToken.None);

        var members = await db.ServerMembers.AsNoTracking().Include(x => x.Role).ToListAsync();
        Assert.Equal(5, members.Count);
        Assert.All(members, member => Assert.Equal(member.Role.IsOwner ? 1 : null, member.OwnerSlot));
        Assert.Equal(MajaId, Assert.Single(members, x => x.OwnerSlot == 1).UserId);
    }

    [Fact]
    public async Task UpgradeKeepsTheEarliestOwnerAndMovesALaterOneToTheMemberRole()
    {
        using var isolated = new StellarrWebApplicationFactory();
        await using var scope = isolated.OpenScope(out var db);
        var ownerRoleId = await db.ServerRoles.Where(x => x.IsOwner).Select(x => x.Id).SingleAsync();
        var memberRoleId = await db.ServerRoles
            .Where(x => x.IsSystem && !x.IsOwner).Select(x => x.Id).SingleAsync();
        // An older build could end up here: a second owner, without a slot.
        await db.ServerMembers.Where(x => x.UserId == IlyaId)
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(x => x.RoleId, ownerRoleId)
                .SetProperty(x => x.JoinedAt, DateTime.UtcNow.AddDays(1)));

        await DatabaseSchema.UpgradeAsync(db, CancellationToken.None);

        var owner = await db.ServerMembers.AsNoTracking().SingleAsync(x => x.UserId == MajaId);
        var demoted = await db.ServerMembers.AsNoTracking().SingleAsync(x => x.UserId == IlyaId);
        Assert.Equal((ownerRoleId, 1), (owner.RoleId, owner.OwnerSlot));
        Assert.Equal((memberRoleId, (int?)null), (demoted.RoleId, demoted.OwnerSlot));
    }

    [Fact]
    public async Task UpgradeAddsWhatAnOlderDatabaseLacksAndKeepsItsRows()
    {
        await using var database = await OlderDatabase.OpenAsync();
        var db = database.Db;
        var (ownerId, memberId) = (database.OwnerId, database.MemberId);
        await db.Database.ExecuteSqlRawAsync(
            """
            DROP TABLE "ChannelReads";
            ALTER TABLE "Channels" DROP COLUMN "Topic";
            ALTER TABLE "Channels" DROP COLUMN "SlowModeSeconds";
            ALTER TABLE "Channels" DROP COLUMN "HideAfterInactivityHours";
            ALTER TABLE "Channels" DROP COLUMN "AudioProfile";
            ALTER TABLE "Channels" DROP COLUMN "UserLimit";
            ALTER TABLE "Servers" DROP COLUMN "Description";
            ALTER TABLE "Servers" DROP COLUMN "IsPublic";
            DROP INDEX "IX_ServerMembers_ServerId_OwnerSlot";
            ALTER TABLE "ServerMembers" DROP COLUMN "OwnerSlot";
            """);

        await DatabaseSchema.UpgradeAsync(db, CancellationToken.None);
        // Every start runs the steps again.
        await DatabaseSchema.UpgradeAsync(db, CancellationToken.None);

        var channel = await db.Channels.AsNoTracking().SingleAsync();
        Assert.Equal(("", 0, 0, "premium", 0), (channel.Topic, channel.SlowModeSeconds, channel.HideAfterInactivityHours, channel.AudioProfile, channel.UserLimit));
        var server = await db.Servers.AsNoTracking().SingleAsync();
        Assert.Equal(("", false), (server.Description, server.IsPublic));
        Assert.Equal(1, (await db.ServerMembers.AsNoTracking().SingleAsync(x => x.UserId == ownerId)).OwnerSlot);
        Assert.Null((await db.ServerMembers.AsNoTracking().SingleAsync(x => x.UserId == memberId)).OwnerSlot);

        db.ChannelReads.Add(new ChannelRead { ChannelId = channel.Id, UserId = memberId, LastReadAt = DateTime.UtcNow });
        await db.SaveChangesAsync();
        Assert.Equal(1, await db.ChannelReads.CountAsync());
    }

    [Fact]
    public async Task UpgradeRebuildsTheRoleAndMembershipTablesOfTheFirstRelease()
    {
        await using var database = await OlderDatabase.OpenAsync(withMembers: false);
        var db = database.Db;
        await db.Database.ExecuteSqlRawAsync(
            """
            DROP TABLE "PermissionOverrides";
            DROP TABLE "ServerMembers";
            DROP TABLE "ServerRoles";
            """);

        await DatabaseSchema.UpgradeAsync(db, CancellationToken.None);

        var role = new ServerRole
        {
            Id = Guid.NewGuid(),
            ServerId = database.ServerId,
            Name = "Właściciel",
            Color = "#d65775",
            Permissions = ServerPrivileges.All,
            IsSystem = true,
            IsOwner = true,
        };
        db.ServerRoles.Add(role);
        db.ServerMembers.Add(new ServerMember
        {
            ServerId = database.ServerId,
            UserId = database.OwnerId,
            RoleId = role.Id,
            OwnerSlot = 1,
            JoinedAt = DateTime.UtcNow,
        });
        await db.SaveChangesAsync();
        Assert.Equal(ServerPrivileges.All, await ServerAccess.GetAsync(db, database.OwnerId, database.ServerId));

        // The second owner a server could once end up with is refused by the database itself.
        db.ServerMembers.Add(new ServerMember
        {
            ServerId = database.ServerId,
            UserId = database.MemberId,
            RoleId = role.Id,
            OwnerSlot = 1,
            JoinedAt = DateTime.UtcNow,
        });
        var failure = await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
        Assert.Equal(19, Assert.IsType<SqliteException>(failure.GetBaseException()).SqliteErrorCode);
    }

    private static Task<bool> HasOnChannelAsync(
        AppDbContext db, TestMember member, Guid channelId, ServerPrivileges privilege) =>
        ServerAccess.HasAsync(db, member.UserId, TestData.ServerId, channelId, privilege);

    private static Task<bool> HasOnSectionAsync(
        AppDbContext db, TestMember member, Guid sectionId, ServerPrivileges privilege) =>
        ServerAccess.HasForSectionAsync(db, member.UserId, TestData.ServerId, sectionId, privilege);

    /// <summary>A member of the seeded server with a role of their own, so no test shares an override with another.</summary>
    private static async Task<TestMember> AddMemberAsync(AppDbContext db, ServerPrivileges privileges)
    {
        var user = (await DataModelSupport.AddUsersAsync(db, 1))[0];
        var role = new ServerRole
        {
            Id = Guid.NewGuid(),
            ServerId = TestData.ServerId,
            Name = DataModelSupport.UniqueName(),
            Color = "#777777",
            Permissions = privileges,
            Position = 10,
        };
        db.ServerRoles.Add(role);
        db.ServerMembers.Add(new ServerMember
        {
            ServerId = TestData.ServerId,
            UserId = user.Id,
            RoleId = role.Id,
            JoinedAt = DateTime.UtcNow,
        });
        await db.SaveChangesAsync();
        return new TestMember(user.Id, role.Id);
    }

    private static async Task<Section> AddSectionAsync(AppDbContext db)
    {
        var section = new Section { Id = Guid.NewGuid(), ServerId = TestData.ServerId, Name = DataModelSupport.UniqueName() };
        db.Sections.Add(section);
        await db.SaveChangesAsync();
        return section;
    }

    private static async Task<Channel> AddChannelAsync(AppDbContext db, Guid? sectionId)
    {
        var channel = new Channel
        {
            Id = Guid.NewGuid(),
            ServerId = TestData.ServerId,
            Name = DataModelSupport.UniqueName(),
            Kind = ChannelKind.Text,
            SectionId = sectionId,
        };
        db.Channels.Add(channel);
        await db.SaveChangesAsync();
        return channel;
    }

    private static void AddOverride(
        AppDbContext db,
        PermissionTargetType target,
        Guid targetId,
        Guid roleId,
        ServerPrivileges allow = ServerPrivileges.None,
        ServerPrivileges deny = ServerPrivileges.None) =>
        db.PermissionOverrides.Add(new PermissionOverride
        {
            Id = Guid.NewGuid(),
            ServerId = TestData.ServerId,
            TargetType = target,
            TargetId = targetId,
            RoleId = roleId,
            AllowMask = allow,
            DenyMask = deny,
        });

    private sealed record TestMember(Guid UserId, Guid RoleId);

    /// <summary>
    /// A database file with one server, a channel and two accounts, which a
    /// test then takes back to the shape an older release wrote.
    /// </summary>
    private sealed class OlderDatabase : IAsyncDisposable
    {
        private readonly string _path = Path.Combine(Path.GetTempPath(), $"stellarr-servers-upgrade-{Guid.NewGuid():N}.db");

        internal AppDbContext Db { get; private set; } = null!;
        internal Guid ServerId { get; } = Guid.NewGuid();
        internal Guid OwnerId { get; private set; }
        internal Guid MemberId { get; private set; }

        internal static async Task<OlderDatabase> OpenAsync(bool withMembers = true)
        {
            var database = new OlderDatabase();
            database.Db = new AppDbContext(
                new DbContextOptionsBuilder<AppDbContext>().UseSqlite($"Data Source={database._path}").Options);
            await database.SeedAsync(withMembers);
            return database;
        }

        public async ValueTask DisposeAsync()
        {
            await Db.DisposeAsync();
            SqliteConnection.ClearAllPools();
            foreach (var file in Directory.GetFiles(Path.GetDirectoryName(_path)!, $"{Path.GetFileName(_path)}*"))
            {
                File.Delete(file);
            }
        }

        private async Task SeedAsync(bool withMembers)
        {
            await Db.Database.EnsureCreatedAsync();
            var users = await DataModelSupport.AddUsersAsync(Db, 2);
            (OwnerId, MemberId) = (users[0].Id, users[1].Id);

            var now = DateTime.UtcNow;
            Db.Servers.Add(new StellarrServer { Id = ServerId, Name = "Orbit", CreatedAt = now });
            Db.Channels.Add(new Channel { Id = Guid.NewGuid(), ServerId = ServerId, Name = "ogólny", Kind = ChannelKind.Text });
            if (withMembers)
            {
                var ownerRole = new ServerRole
                {
                    Id = Guid.NewGuid(),
                    ServerId = ServerId,
                    Name = "Właściciel",
                    Color = "#d65775",
                    Permissions = ServerPrivileges.All,
                    IsSystem = true,
                    IsOwner = true,
                };
                var memberRole = new ServerRole
                {
                    Id = Guid.NewGuid(),
                    ServerId = ServerId,
                    Name = "Członek",
                    Color = "#777777",
                    Permissions = ServerPrivileges.None,
                    Position = 1,
                    IsSystem = true,
                };
                Db.ServerRoles.AddRange(ownerRole, memberRole);
                Db.ServerMembers.AddRange(
                    new ServerMember { ServerId = ServerId, UserId = OwnerId, RoleId = ownerRole.Id, JoinedAt = now },
                    new ServerMember { ServerId = ServerId, UserId = MemberId, RoleId = memberRole.Id, JoinedAt = now });
            }

            await Db.SaveChangesAsync();
        }
    }
}
