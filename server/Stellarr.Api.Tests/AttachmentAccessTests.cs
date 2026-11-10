using Stellarr.Api.Auth;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;
using static Stellarr.Api.Tests.DataModelSupport;

namespace Stellarr.Api.Tests;

/// <summary>Who may read an attachment, one rule at a time and against strangers.</summary>
public sealed class AttachmentAccessTests(StellarrWebApplicationFactory factory)
    : IClassFixture<StellarrWebApplicationFactory>
{
    [Fact]
    public async Task OnlyTheUploaderReadsAnAttachmentThatNothingUses()
    {
        await using var scope = factory.OpenScope(out var db);
        var users = await AddUsersAsync(db, 2);
        var attachment = await AddAttachmentAsync(db, users[0]);

        Assert.True(await CanReadAsync(db, users[0], attachment));
        Assert.False(await CanReadAsync(db, users[1], attachment));
        Assert.False(await AttachmentAccess.CanReadAsync(db, users[0].Id, Guid.NewGuid()));
    }

    [Theory]
    [InlineData("message")]
    [InlineData("embedThumbnail")]
    public async Task AChannelsAttachmentIsForTheMembersOfItsServer(string use)
    {
        await using var scope = factory.OpenScope(out var db);
        var users = await AddUsersAsync(db, 3);
        var attachment = await AddAttachmentAsync(db, users[0]);
        var (_, channel) = await AddServerAsync(db, isPublic: false, users[1]);
        var message = new Message
        {
            Id = Guid.NewGuid(),
            ChannelId = channel.Id,
            AuthorId = users[1].Id,
            Content = "with a file",
            CreatedAt = DateTime.UtcNow,
        };
        if (use == "message")
        {
            message.Attachments = [new MessageAttachment { Attachment = attachment }];
        }
        else
        {
            message.Embeds =
            [
                new MessageEmbed
                {
                    Id = Guid.NewGuid(),
                    Url = "https://example.test/page",
                    Provider = "example.test",
                    Domain = "example.test",
                    ThumbnailAttachment = attachment,
                },
            ];
        }

        db.Messages.Add(message);
        await db.SaveChangesAsync();

        Assert.True(await CanReadAsync(db, users[1], attachment));
        Assert.False(await CanReadAsync(db, users[2], attachment));
    }

    [Fact]
    public async Task ADirectMessageAttachmentIsForTheTwoPeopleInTheConversation()
    {
        await using var scope = factory.OpenScope(out var db);
        var users = await AddUsersAsync(db, 3);
        var attachment = await AddAttachmentAsync(db, users[0]);
        var conversation = new DirectConversation
        {
            Id = Guid.NewGuid(),
            UserAId = users[0].Id,
            UserBId = users[1].Id,
            CreatedAt = DateTime.UtcNow,
        };
        conversation.Messages =
        [
            new DirectMessage
            {
                Id = Guid.NewGuid(),
                AuthorId = users[0].Id,
                Content = "just between us",
                CreatedAt = DateTime.UtcNow,
                Attachments = [new DirectMessageAttachment { Attachment = attachment }],
            },
        ];
        db.DirectConversations.Add(conversation);
        await db.SaveChangesAsync();

        Assert.True(await CanReadAsync(db, users[1], attachment));
        Assert.False(await CanReadAsync(db, users[2], attachment));
    }

    [Theory]
    [InlineData("avatar")]
    [InlineData("banner")]
    public async Task AProfileImageIsForEverybody(string image)
    {
        await using var scope = factory.OpenScope(out var db);
        var users = await AddUsersAsync(db, 2);
        var attachment = await AddAttachmentAsync(db, users[0]);
        if (image == "avatar")
        {
            users[0].AvatarUrl = $"/assets/{attachment.Id}";
        }
        else
        {
            users[0].BannerUrl = $"/assets/{attachment.Id}";
        }

        await db.SaveChangesAsync();

        Assert.True(await CanReadAsync(db, users[1], attachment));
    }

    [Theory]
    [InlineData(true, true, true)]
    [InlineData(true, false, true)]
    [InlineData(false, true, true)]
    [InlineData(false, false, false)]
    public async Task AServerIconIsForItsMembersUnlessTheServerIsPublic(bool isPublic, bool isMember, bool canRead)
    {
        await using var scope = factory.OpenScope(out var db);
        var users = await AddUsersAsync(db, 3);
        var attachment = await AddAttachmentAsync(db, users[0]);
        var (server, _) = await AddServerAsync(db, isPublic, users[1]);
        server.IconUrl = $"/assets/{attachment.Id}";
        await db.SaveChangesAsync();

        Assert.Equal(canRead, await CanReadAsync(db, isMember ? users[1] : users[2], attachment));
    }

    [Fact]
    public async Task ASoundboardClipIsForTheMembersOfItsServer()
    {
        await using var scope = factory.OpenScope(out var db);
        var users = await AddUsersAsync(db, 3);
        var attachment = await AddAttachmentAsync(db, users[0]);
        var (server, _) = await AddServerAsync(db, isPublic: false, users[1]);
        AddSound(db, server, users[0], attachment);
        await db.SaveChangesAsync();

        Assert.True(await CanReadAsync(db, users[1], attachment));
        Assert.False(await CanReadAsync(db, users[2], attachment));
    }

    [Fact]
    public async Task AJoinSoundIsForPeopleWhoShareAServerOrAConversationWithItsOwner()
    {
        await using var scope = factory.OpenScope(out var db);
        var users = await AddUsersAsync(db, 5);
        var (owner, sharesServer, sharesConversation, stranger, clipAuthor) =
            (users[0], users[1], users[2], users[3], users[4]);
        var attachment = await AddAttachmentAsync(db, clipAuthor);
        var (soundServer, _) = await AddServerAsync(db, isPublic: false, clipAuthor, owner);
        await AddServerAsync(db, isPublic: false, owner, sharesServer);
        var sound = AddSound(db, soundServer, clipAuthor, attachment);
        db.UserPreferences.Add(new UserPreferenceSettings { UserId = owner.Id, JoinSoundId = sound.Id });
        db.DirectConversations.Add(new DirectConversation
        {
            Id = Guid.NewGuid(),
            UserAId = sharesConversation.Id,
            UserBId = owner.Id,
            CreatedAt = DateTime.UtcNow,
        });
        await db.SaveChangesAsync();

        Assert.True(await CanReadAsync(db, sharesServer, attachment));
        Assert.True(await CanReadAsync(db, sharesConversation, attachment));
        Assert.False(await CanReadAsync(db, stranger, attachment));
    }

    private static Task<bool> CanReadAsync(AppDbContext db, User user, ImageAttachment attachment) =>
        AttachmentAccess.CanReadAsync(db, user.Id, attachment.Id);

    private static async Task<ImageAttachment> AddAttachmentAsync(AppDbContext db, User uploader)
    {
        var attachment = Upload(uploader);
        db.ImageAttachments.Add(attachment);
        await db.SaveChangesAsync();
        return attachment;
    }

    private static SoundboardSound AddSound(
        AppDbContext db, StellarrServer server, User creator, ImageAttachment attachment)
    {
        var sound = new SoundboardSound
        {
            Id = Guid.NewGuid(),
            ServerId = server.Id,
            AttachmentId = attachment.Id,
            CreatedById = creator.Id,
            Name = UniqueName(),
            Glyph = "x",
        };
        db.SoundboardSounds.Add(sound);
        return sound;
    }

    private static async Task<(StellarrServer Server, Channel Channel)> AddServerAsync(
        AppDbContext db, bool isPublic, params User[] members)
    {
        var server = new StellarrServer
        {
            Id = Guid.NewGuid(),
            Name = UniqueName(),
            IsPublic = isPublic,
            CreatedAt = DateTime.UtcNow,
        };
        var role = new ServerRole
        {
            Id = Guid.NewGuid(),
            ServerId = server.Id,
            Name = "Członek",
            Color = "#777777",
            Permissions = ServerPrivileges.None,
            IsSystem = true,
        };
        var channel = new Channel { Id = Guid.NewGuid(), ServerId = server.Id, Name = "ogólny", Kind = ChannelKind.Text };
        db.Servers.Add(server);
        db.ServerRoles.Add(role);
        db.Channels.Add(channel);
        db.ServerMembers.AddRange(members.Select(member => new ServerMember
        {
            ServerId = server.Id,
            UserId = member.Id,
            RoleId = role.Id,
            JoinedAt = DateTime.UtcNow,
        }));
        await db.SaveChangesAsync();
        return (server, channel);
    }
}
