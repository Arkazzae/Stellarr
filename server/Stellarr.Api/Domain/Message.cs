namespace Stellarr.Api.Domain;

public sealed class Message
{
    public Guid Id { get; set; }
    public Guid ChannelId { get; set; }

    /// <summary>The person who wrote it, or whose action caused a system notice.</summary>
    public Guid AuthorId { get; set; }

    /// <summary>
    /// A durable server notice, such as a member joining. <see cref="AuthorId"/>
    /// still names the person behind it, while the wire contract exposes the
    /// reserved <c>system</c> author so clients do not offer person-only actions.
    /// </summary>
    public bool IsSystem { get; set; }

    public required string Content { get; set; }
    public DateTime CreatedAt { get; set; }

    /// <summary>
    /// When the author last rewrote it, or null if they never did. A timestamp
    /// rather than a flag because "edited" is a claim readers may check, and
    /// the moment is the only form of it that stays true as the message ages.
    /// </summary>
    public DateTime? EditedAt { get; set; }

    /// <summary>
    /// When somebody pinned it, or null. A timestamp for the same reason as
    /// <see cref="EditedAt"/>, and because the pinned list is ordered by it,
    /// newest first.
    /// </summary>
    public DateTime? PinnedAt { get; set; }

    /// <summary>The message this one answers, if it is a reply.</summary>
    public Guid? ReplyToMessageId { get; set; }

    public User Author { get; set; } = null!;
    public Message? ReplyToMessage { get; set; }
    public ICollection<MessageAttachment> Attachments { get; set; } = [];
    public ICollection<MessageEmbed> Embeds { get; set; } = [];
    public ICollection<MessageReaction> Reactions { get; set; } = [];
}

/// <summary>One user's durable reaction to one message.</summary>
public sealed class MessageReaction
{
    public Guid MessageId { get; set; }
    public Guid UserId { get; set; }
    public required string Emoji { get; set; }
    public DateTime CreatedAt { get; set; }

    public Message Message { get; set; } = null!;
    public User User { get; set; } = null!;
}
