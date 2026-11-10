namespace Stellarr.Api.Domain;

/// <summary>A symmetric friendship, stored once with the user ids in canonical order.</summary>
public sealed class Friendship
{
    public Guid Id { get; set; }
    public Guid UserAId { get; set; }
    public Guid UserBId { get; set; }
    public DateTime CreatedAt { get; set; }
}

/// <summary>A pending, directed friend request; an answered request is deleted.</summary>
public sealed class FriendRequest
{
    public Guid Id { get; set; }
    public Guid SenderId { get; set; }
    public Guid ReceiverId { get; set; }

    /// <summary>
    /// Both user ids in a fixed order, whichever way the request points, so one
    /// unique index allows a single pending request per pair of people.
    /// </summary>
    public required string PairKey { get; set; }

    public DateTime CreatedAt { get; set; }
}

/// <summary>A directed block. Blocking also removes the friendship and pending requests.</summary>
public sealed class UserBlock
{
    public Guid BlockerId { get; set; }
    public Guid BlockedId { get; set; }
    public DateTime CreatedAt { get; set; }
}

/// <summary>A private conversation between exactly two people, in canonical user-id order.</summary>
public sealed class DirectConversation
{
    public Guid Id { get; set; }
    public Guid UserAId { get; set; }
    public Guid UserBId { get; set; }
    public DateTime CreatedAt { get; set; }

    public ICollection<DirectMessage> Messages { get; set; } = [];
}

public sealed class DirectMessage
{
    public Guid Id { get; set; }
    public Guid ConversationId { get; set; }
    public Guid AuthorId { get; set; }
    public required string Content { get; set; }
    public DateTime CreatedAt { get; set; }

    public User Author { get; set; } = null!;
    public ICollection<DirectMessageAttachment> Attachments { get; set; } = [];
}

public sealed class DirectMessageAttachment
{
    public Guid DirectMessageId { get; set; }
    public Guid AttachmentId { get; set; }

    public DirectMessage DirectMessage { get; set; } = null!;
    public ImageAttachment Attachment { get; set; } = null!;
}

/// <summary>A person's read watermark in one conversation, from which its unread count follows.</summary>
public sealed class DirectConversationRead
{
    public Guid ConversationId { get; set; }
    public Guid UserId { get; set; }
    public DateTime LastReadAt { get; set; }
}
