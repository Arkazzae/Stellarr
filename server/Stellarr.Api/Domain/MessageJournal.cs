namespace Stellarr.Api.Domain;

public enum MessageChangeKind
{
    Upsert = 0,
    Delete = 1,
    Reset = 2,
}

/// <summary>
/// One entry of the durable journal that clients replay to close the gap left
/// by a dropped realtime connection. It has no foreign key to the message: a
/// deletion is itself an event, and it has to outlive the row it announces.
/// </summary>
public sealed class MessageChange
{
    /// <summary>The journal position, assigned by the database on insert.</summary>
    public long Sequence { get; set; }

    public Guid ChannelId { get; set; }
    public Guid MessageId { get; set; }
    public MessageChangeKind Kind { get; set; }
    public DateTime CreatedAt { get; set; }
}

/// <summary>
/// The search and media catalogue row of one channel message.
/// </summary>
/// <remarks>
/// The full-text index holds the tokens, while this ordinary table holds what
/// is needed to page through all media and links without walking the
/// transcript. Database triggers keep both in step with messages, attachments
/// and the embeds that are built asynchronously.
/// </remarks>
public sealed class MessageIndexEntry
{
    public Guid MessageId { get; set; }
    public Guid ChannelId { get; set; }
    public DateTime CreatedAt { get; set; }
    public required string SearchText { get; set; }
    public bool HasAttachments { get; set; }
    public bool HasLinks { get; set; }
}
