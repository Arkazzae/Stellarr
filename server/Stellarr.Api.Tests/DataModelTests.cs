using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Domain;
using static Stellarr.Api.Tests.DataModelSupport;

namespace Stellarr.Api.Tests;

/// <summary>
/// The entity model against a database that EnsureCreated has just made: the
/// tables exist, the unique indexes that carry invariants hold, and the foreign
/// keys do what each relationship promises when a parent row goes away.
/// </summary>
public sealed class DataModelTests(StellarrWebApplicationFactory factory)
    : IClassFixture<StellarrWebApplicationFactory>
{
    [Fact]
    public async Task OnlyOneMemberOfAServerHoldsTheOwnerSlot()
    {
        await using var scope = factory.OpenScope(out var db);
        var extra = await AddUsersAsync(db, 3);
        var roleId = await db.ServerRoles.Select(x => x.Id).FirstAsync();

        // Many nulls are fine: every ordinary member leaves the slot empty.
        db.ServerMembers.AddRange(
            Member(extra[0], roleId, ownerSlot: null),
            Member(extra[1], roleId, ownerSlot: null));
        await db.SaveChangesAsync();

        // The seeded owner already holds slot 1.
        db.ServerMembers.Add(Member(extra[2], roleId, ownerSlot: 1));
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
    }

    [Fact]
    public async Task SessionsRecoveryTokensAndLoginsAreStoredAndLeaveWithTheirUser()
    {
        await using var scope = factory.OpenScope(out var db);
        var user = (await AddUsersAsync(db, 1))[0];
        var now = DateTime.UtcNow;
        db.UserSessions.Add(new UserSession
        {
            Id = Guid.NewGuid(),
            UserId = user.Id,
            Device = "Firefox on Linux",
            IpAddress = "203.0.113.7",
            CreatedAt = now,
            LastSeenAt = now,
            ExpiresAt = now.AddDays(30),
        });
        db.PasswordResetTokens.Add(new PasswordResetToken
        {
            Id = Guid.NewGuid(),
            UserId = user.Id,
            TokenHash = Hash(),
            CreatedAt = now,
            ExpiresAt = now.AddHours(1),
        });
        db.ExternalIdentities.Add(new ExternalIdentity
        {
            Id = Guid.NewGuid(),
            UserId = user.Id,
            Issuer = "https://id.example",
            Subject = "subject-1",
            CreatedAt = now,
        });
        db.DesktopBrowserLogins.AddRange(
            new DesktopBrowserLogin
            {
                Id = Guid.NewGuid(),
                SecretHash = Hash(),
                CreatedAt = now,
                ExpiresAt = now.AddMinutes(5),
            },
            new DesktopBrowserLogin
            {
                Id = Guid.NewGuid(),
                SecretHash = Hash(),
                UserId = user.Id,
                CreatedAt = now,
                ExpiresAt = now.AddMinutes(5),
                ApprovedAt = now,
            });
        await db.SaveChangesAsync();

        Assert.Equal(1, await db.UserSessions.CountAsync(x => x.UserId == user.Id));
        Assert.Equal(1, await db.PasswordResetTokens.CountAsync(x => x.UserId == user.Id));
        Assert.Equal(1, await db.ExternalIdentities.CountAsync(x => x.UserId == user.Id));
        Assert.Equal(1, await db.DesktopBrowserLogins.CountAsync(x => x.UserId == user.Id));
        Assert.Equal(1, await db.DesktopBrowserLogins.CountAsync(x => x.UserId == null));

        await db.Users.Where(x => x.Id == user.Id).ExecuteDeleteAsync();

        Assert.Equal(0, await db.UserSessions.CountAsync(x => x.UserId == user.Id));
        Assert.Equal(0, await db.PasswordResetTokens.CountAsync(x => x.UserId == user.Id));
        Assert.Equal(0, await db.ExternalIdentities.CountAsync(x => x.UserId == user.Id));
        Assert.Equal(0, await db.DesktopBrowserLogins.CountAsync(x => x.UserId == user.Id));
        Assert.Equal(1, await db.DesktopBrowserLogins.CountAsync(x => x.UserId == null));
    }

    [Fact]
    public async Task AnExternalSubjectLinksToOneAccountAndAnAccountToOneSubjectPerIssuer()
    {
        await using var scope = factory.OpenScope(out var db);
        var users = await AddUsersAsync(db, 2);
        db.ExternalIdentities.Add(Identity(users[0], "https://id.example", "subject-2"));
        await db.SaveChangesAsync();

        db.ExternalIdentities.Add(Identity(users[1], "https://id.example", "subject-2"));
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
        db.ChangeTracker.Clear();

        db.ExternalIdentities.Add(Identity(users[0], "https://id.example", "subject-3"));
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
        db.ChangeTracker.Clear();

        // The same subject under another issuer, or another issuer for the same
        // account, is a different identity.
        db.ExternalIdentities.AddRange(
            Identity(users[1], "https://other.example", "subject-2"),
            Identity(users[0], "https://other.example", "subject-3"));
        await db.SaveChangesAsync();
    }

    [Fact]
    public async Task ARecoveryTokenDigestIsStoredOnce()
    {
        await using var scope = factory.OpenScope(out var db);
        var user = (await AddUsersAsync(db, 1))[0];
        var digest = Hash();
        db.PasswordResetTokens.Add(RecoveryToken(user, digest));
        await db.SaveChangesAsync();

        db.PasswordResetTokens.Add(RecoveryToken(user, digest));
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
    }

    [Fact]
    public async Task OnePendingFriendRequestExistsPerPairWhicheverWayItPoints()
    {
        await using var scope = factory.OpenScope(out var db);
        var users = await AddUsersAsync(db, 2);
        db.FriendRequests.Add(Request(users[0], users[1]));
        await db.SaveChangesAsync();

        db.FriendRequests.Add(Request(users[1], users[0]));
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
    }

    [Fact]
    public async Task AFriendshipAndAConversationBelongToOnePairOfUsers()
    {
        await using var scope = factory.OpenScope(out var db);
        var users = await AddUsersAsync(db, 3);
        db.Friendships.Add(Friendship(users[0], users[1]));
        db.DirectConversations.Add(Conversation(users[0], users[1]));
        await db.SaveChangesAsync();

        // A different partner is a different pair.
        db.Friendships.Add(Friendship(users[0], users[2]));
        db.DirectConversations.Add(Conversation(users[0], users[2]));
        await db.SaveChangesAsync();

        db.Friendships.Add(Friendship(users[0], users[1]));
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
        db.ChangeTracker.Clear();

        db.DirectConversations.Add(Conversation(users[0], users[1]));
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
    }

    [Fact]
    public async Task DeletingAnAccountRemovesItsFriendshipsRequestsBlocksAndConversations()
    {
        await using var scope = factory.OpenScope(out var db);
        var users = await AddUsersAsync(db, 3);
        var (leaving, friend, stranger) = (users[0], users[1], users[2]);
        var conversation = Conversation(leaving, friend);
        db.Friendships.Add(Friendship(leaving, friend));
        db.FriendRequests.AddRange(Request(leaving, stranger), Request(stranger, friend));
        db.UserBlocks.AddRange(
            new UserBlock { BlockerId = leaving.Id, BlockedId = stranger.Id, CreatedAt = DateTime.UtcNow },
            new UserBlock { BlockerId = stranger.Id, BlockedId = leaving.Id, CreatedAt = DateTime.UtcNow });
        db.DirectConversations.Add(conversation);
        db.DirectConversationReads.Add(new DirectConversationRead
        {
            ConversationId = conversation.Id,
            UserId = friend.Id,
            LastReadAt = DateTime.UtcNow,
        });
        await db.SaveChangesAsync();

        await db.Users.Where(x => x.Id == leaving.Id).ExecuteDeleteAsync();

        Assert.False(await db.Friendships.AnyAsync(x => x.UserAId == leaving.Id || x.UserBId == leaving.Id));
        Assert.False(await db.UserBlocks.AnyAsync(x => x.BlockerId == leaving.Id || x.BlockedId == leaving.Id));
        Assert.False(await db.DirectConversations.AnyAsync(x => x.Id == conversation.Id));
        Assert.False(await db.DirectConversationReads.AnyAsync(x => x.ConversationId == conversation.Id));
        var remaining = await db.FriendRequests
            .Where(x => x.SenderId == stranger.Id || x.ReceiverId == stranger.Id)
            .ToListAsync();
        Assert.Equal([friend.Id], remaining.Select(x => x.ReceiverId));
    }

    [Fact]
    public async Task ADirectConversationOwnsItsMessagesAttachmentLinksAndReadMarks()
    {
        await using var scope = factory.OpenScope(out var db);
        var users = await AddUsersAsync(db, 2);
        var conversation = Conversation(users[0], users[1]);
        var attachment = Upload(users[0]);
        var message = new DirectMessage
        {
            Id = Guid.NewGuid(),
            ConversationId = conversation.Id,
            AuthorId = users[0].Id,
            Content = "see attached",
            CreatedAt = DateTime.UtcNow,
            Attachments = [new DirectMessageAttachment { AttachmentId = attachment.Id }],
        };
        db.DirectConversations.Add(conversation);
        db.ImageAttachments.Add(attachment);
        db.DirectMessages.Add(message);
        db.DirectConversationReads.Add(new DirectConversationRead
        {
            ConversationId = conversation.Id,
            UserId = users[1].Id,
            LastReadAt = DateTime.UtcNow,
        });
        await db.SaveChangesAsync();

        // A stored object must not be dropped from under a message that shows it.
        await Assert.ThrowsAsync<SqliteException>(
            () => db.ImageAttachments.Where(x => x.Id == attachment.Id).ExecuteDeleteAsync());

        await db.DirectConversations.Where(x => x.Id == conversation.Id).ExecuteDeleteAsync();

        Assert.False(await db.DirectMessages.AnyAsync(x => x.Id == message.Id));
        Assert.False(await db.DirectMessageAttachments.AnyAsync(x => x.DirectMessageId == message.Id));
        Assert.False(await db.DirectConversationReads.AnyAsync(x => x.ConversationId == conversation.Id));
        Assert.True(await db.ImageAttachments.AnyAsync(x => x.Id == attachment.Id));
    }

    [Fact]
    public async Task DeletingAChannelDetachesItsInvitesAndRemovesItsReadMarks()
    {
        await using var scope = factory.OpenScope(out var db);
        var user = (await AddUsersAsync(db, 1))[0];
        var channel = new Channel { Id = Guid.NewGuid(), ServerId = TestData.ServerId, Name = UniqueName() };
        var invite = Invite(user, channel.Id);
        db.Channels.Add(channel);
        db.ServerInvites.Add(invite);
        db.ChannelReads.Add(new ChannelRead { ChannelId = channel.Id, UserId = user.Id, LastReadAt = DateTime.UtcNow });
        await db.SaveChangesAsync();

        await db.Channels.Where(x => x.Id == channel.Id).ExecuteDeleteAsync();

        Assert.Null(await db.ServerInvites.Where(x => x.Id == invite.Id).Select(x => x.ChannelId).SingleAsync());
        Assert.False(await db.ChannelReads.AnyAsync(x => x.ChannelId == channel.Id));
    }

    [Fact]
    public async Task AnInviteCodeIsUnique()
    {
        await using var scope = factory.OpenScope(out var db);
        var user = (await AddUsersAsync(db, 1))[0];
        var first = Invite(user, channelId: null);
        db.ServerInvites.Add(first);
        await db.SaveChangesAsync();

        var copy = Invite(user, channelId: null);
        copy.Code = first.Code;
        db.ServerInvites.Add(copy);
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
    }

    [Fact]
    public async Task AUserIsBannedFromAServerOnce()
    {
        await using var scope = factory.OpenScope(out var db);
        var users = await AddUsersAsync(db, 2);
        db.ServerBans.Add(Ban(users[0], users[1]));
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();

        db.ServerBans.Add(Ban(users[0], users[1]));
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
    }

    [Fact]
    public async Task APersonWhoActedForAServerCannotBeDeletedWhileTheRecordStands()
    {
        await using var scope = factory.OpenScope(out var db);
        var users = await AddUsersAsync(db, 3);
        db.ServerBans.Add(Ban(users[0], users[1]));
        db.ServerInvites.Add(Invite(users[2], channelId: null));
        await db.SaveChangesAsync();
        db.ServerAuditEntries.Add(new ServerAuditEntry
        {
            Id = Guid.NewGuid(),
            ServerId = TestData.ServerId,
            ActorId = users[0].Id,
            Summary = "banned someone",
            CreatedAt = DateTime.UtcNow,
        });
        await db.SaveChangesAsync();

        // The moderator, the audit actor and the inviter are all kept by Restrict.
        await Assert.ThrowsAsync<SqliteException>(
            () => db.Users.Where(x => x.Id == users[0].Id).ExecuteDeleteAsync());
        await Assert.ThrowsAsync<SqliteException>(
            () => db.Users.Where(x => x.Id == users[2].Id).ExecuteDeleteAsync());

        // Being the one who was banned is not a reason to keep the account.
        await db.Users.Where(x => x.Id == users[1].Id).ExecuteDeleteAsync();
        Assert.False(await db.ServerBans.AnyAsync(x => x.UserId == users[1].Id));
    }

    [Fact]
    public async Task ARoleHasAtMostOneOverridePerChannelOrSection()
    {
        await using var scope = factory.OpenScope(out var db);
        var role = await db.ServerRoles.FirstAsync();
        var target = Guid.NewGuid();
        db.PermissionOverrides.Add(Override(role.Id, PermissionTargetType.Channel, target));
        await db.SaveChangesAsync();

        // The same id as a section is another target, and so is another role.
        db.PermissionOverrides.Add(Override(role.Id, PermissionTargetType.Section, target));
        db.PermissionOverrides.Add(Override(
            await db.ServerRoles.Where(x => x.Id != role.Id).Select(x => x.Id).FirstAsync(),
            PermissionTargetType.Channel,
            target));
        await db.SaveChangesAsync();

        db.PermissionOverrides.Add(Override(role.Id, PermissionTargetType.Channel, target));
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
    }

    [Fact]
    public async Task OverridesKeepTheirPrivilegeMasks()
    {
        await using var scope = factory.OpenScope(out var db);
        var role = await db.ServerRoles.FirstAsync();
        var saved = Override(role.Id, PermissionTargetType.Section, Guid.NewGuid());
        saved.AllowMask = ServerPrivileges.ManageMessages | ServerPrivileges.ManageBans;
        saved.DenyMask = ServerPrivileges.ManageChannels;
        db.PermissionOverrides.Add(saved);
        await db.SaveChangesAsync();

        var loaded = await db.PermissionOverrides.AsNoTracking().SingleAsync(x => x.Id == saved.Id);

        Assert.Equal(PermissionTargetType.Section, loaded.TargetType);
        Assert.Equal(ServerPrivileges.ManageMessages | ServerPrivileges.ManageBans, loaded.AllowMask);
        Assert.Equal(ServerPrivileges.ManageChannels, loaded.DenyMask);
    }

    [Fact]
    public async Task DeletingAServerRemovesItsAdministrativeRecords()
    {
        await using var scope = factory.OpenScope(out var db);
        var users = await AddUsersAsync(db, 2);
        var server = new StellarrServer { Id = Guid.NewGuid(), Name = "Doomed", CreatedAt = DateTime.UtcNow };
        var role = new ServerRole
        {
            Id = Guid.NewGuid(),
            ServerId = server.Id,
            Name = "Helper",
            Color = "#777777",
        };
        db.Servers.Add(server);
        db.ServerRoles.Add(role);
        db.ServerBans.Add(new ServerBan
        {
            ServerId = server.Id,
            UserId = users[1].Id,
            BannedById = users[0].Id,
            Reason = "spam",
            BannedAt = DateTime.UtcNow,
        });
        db.ServerInvites.Add(new ServerInvite
        {
            Id = Guid.NewGuid(),
            ServerId = server.Id,
            CreatedById = users[0].Id,
            Code = UniqueName(),
            CreatedAt = DateTime.UtcNow,
        });
        db.ServerAuditEntries.Add(new ServerAuditEntry
        {
            Id = Guid.NewGuid(),
            ServerId = server.Id,
            ActorId = users[0].Id,
            Summary = "created the server",
            CreatedAt = DateTime.UtcNow,
        });
        db.Sections.Add(new Section { Id = Guid.NewGuid(), ServerId = server.Id, Name = "Voice" });
        db.PermissionOverrides.Add(Override(role.Id, PermissionTargetType.Section, Guid.NewGuid(), server.Id));
        await db.SaveChangesAsync();

        await db.Servers.Where(x => x.Id == server.Id).ExecuteDeleteAsync();

        Assert.False(await db.ServerBans.AnyAsync(x => x.ServerId == server.Id));
        Assert.False(await db.ServerInvites.AnyAsync(x => x.ServerId == server.Id));
        Assert.False(await db.ServerAuditEntries.AnyAsync(x => x.ServerId == server.Id));
        Assert.False(await db.Sections.AnyAsync(x => x.ServerId == server.Id));
        Assert.False(await db.PermissionOverrides.AnyAsync(x => x.ServerId == server.Id));
    }

    [Fact]
    public async Task DeletingARoleRemovesItsOverrides()
    {
        await using var scope = factory.OpenScope(out var db);
        var role = new ServerRole
        {
            Id = Guid.NewGuid(),
            ServerId = TestData.ServerId,
            Name = UniqueName(),
            Color = "#777777",
        };
        db.ServerRoles.Add(role);
        db.PermissionOverrides.Add(Override(role.Id, PermissionTargetType.Channel, TestData.GeneralChannelId));
        await db.SaveChangesAsync();

        await db.ServerRoles.Where(x => x.Id == role.Id).ExecuteDeleteAsync();

        Assert.False(await db.PermissionOverrides.AnyAsync(x => x.RoleId == role.Id));
    }

    private static ServerMember Member(User user, Guid roleId, int? ownerSlot) => new()
    {
        ServerId = TestData.ServerId,
        UserId = user.Id,
        RoleId = roleId,
        OwnerSlot = ownerSlot,
        JoinedAt = DateTime.UtcNow,
    };

    private static ExternalIdentity Identity(User user, string issuer, string subject) => new()
    {
        Id = Guid.NewGuid(),
        UserId = user.Id,
        Issuer = issuer,
        Subject = subject,
        CreatedAt = DateTime.UtcNow,
    };

    private static PasswordResetToken RecoveryToken(User user, string digest) => new()
    {
        Id = Guid.NewGuid(),
        UserId = user.Id,
        TokenHash = digest,
        CreatedAt = DateTime.UtcNow,
        ExpiresAt = DateTime.UtcNow.AddHours(1),
    };

    private static FriendRequest Request(User sender, User receiver) => new()
    {
        Id = Guid.NewGuid(),
        SenderId = sender.Id,
        ReceiverId = receiver.Id,
        PairKey = PairKey(sender, receiver),
        CreatedAt = DateTime.UtcNow,
    };

    private static string PairKey(User first, User second) =>
        string.Join(':', new[] { first.Id, second.Id }.Order().Select(id => id.ToString("N")));

    private static Friendship Friendship(User first, User second)
    {
        var (a, b) = Ordered(first, second);
        return new Friendship { Id = Guid.NewGuid(), UserAId = a, UserBId = b, CreatedAt = DateTime.UtcNow };
    }

    private static DirectConversation Conversation(User first, User second)
    {
        var (a, b) = Ordered(first, second);
        return new DirectConversation { Id = Guid.NewGuid(), UserAId = a, UserBId = b, CreatedAt = DateTime.UtcNow };
    }

    private static (Guid, Guid) Ordered(User first, User second) =>
        first.Id.CompareTo(second.Id) <= 0 ? (first.Id, second.Id) : (second.Id, first.Id);

    private static ServerInvite Invite(User creator, Guid? channelId) => new()
    {
        Id = Guid.NewGuid(),
        ServerId = TestData.ServerId,
        CreatedById = creator.Id,
        ChannelId = channelId,
        Code = UniqueName(),
        CreatedAt = DateTime.UtcNow,
    };

    private static ServerBan Ban(User moderator, User banned) => new()
    {
        ServerId = TestData.ServerId,
        UserId = banned.Id,
        BannedById = moderator.Id,
        Reason = "spam",
        BannedAt = DateTime.UtcNow,
    };

    private static PermissionOverride Override(
        Guid roleId,
        PermissionTargetType type,
        Guid targetId,
        Guid? serverId = null) => new()
    {
        Id = Guid.NewGuid(),
        ServerId = serverId ?? TestData.ServerId,
        TargetType = type,
        TargetId = targetId,
        RoleId = roleId,
        AllowMask = ServerPrivileges.None,
        DenyMask = ServerPrivileges.None,
    };
}
