using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;

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
        await using var scope = Open(out var db);
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
        await using var scope = Open(out var db);
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
        await using var scope = Open(out var db);
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
        await using var scope = Open(out var db);
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
        await using var scope = Open(out var db);
        var users = await AddUsersAsync(db, 2);
        db.FriendRequests.Add(Request(users[0], users[1]));
        await db.SaveChangesAsync();

        db.FriendRequests.Add(Request(users[1], users[0]));
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
    }

    [Fact]
    public async Task AFriendshipAndAConversationBelongToOnePairOfUsers()
    {
        await using var scope = Open(out var db);
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
        await using var scope = Open(out var db);
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
        await using var scope = Open(out var db);
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

    private AsyncServiceScope Open(out AppDbContext db)
    {
        var scope = factory.Services.CreateAsyncScope();
        db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        return scope;
    }

    /// <summary>Adds accounts that no other test knows about and returns them.</summary>
    private static async Task<User[]> AddUsersAsync(AppDbContext db, int count)
    {
        var users = Enumerable.Range(0, count).Select(_ =>
        {
            var name = $"u{Guid.NewGuid():N}"[..20];
            return new User
            {
                Id = Guid.NewGuid(),
                Username = name,
                NormalizedUsername = name.ToUpperInvariant(),
                DisplayName = name,
                PasswordHash = "hash",
                AvatarColor = "#777777",
                CreatedAt = DateTime.UtcNow,
            };
        }).ToArray();
        db.Users.AddRange(users);
        await db.SaveChangesAsync();
        return users;
    }

    private static string Hash() => Convert.ToHexString(Guid.NewGuid().ToByteArray()).PadRight(64, '0');

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

    private static ImageAttachment Upload(User uploader) => new()
    {
        Id = Guid.NewGuid(),
        UploadedById = uploader.Id,
        ObjectKey = $"uploads/{Guid.NewGuid():N}",
        FileName = "note.txt",
        ContentType = "text/plain",
        SizeBytes = 12,
        CreatedAt = DateTime.UtcNow,
    };
}
