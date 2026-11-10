namespace Stellarr.Api.Domain;

public enum EmbedKind
{
    /// <summary>A card summarising somebody else's page.</summary>
    Link = 0,

    /// <summary>A player: the client can put the video itself on screen.</summary>
    Video = 1,
}

/// <summary>
/// An unfurled link belonging to a message.
/// </summary>
/// <remarks>
/// Rows are derived data, never user input: the unfurler writes them and the
/// message body stays the only thing a person authored. They can be deleted
/// and rebuilt at any time, which is what makes re-unfurling a non-event.
/// </remarks>
public sealed class MessageEmbed
{
    public Guid Id { get; set; }
    public Guid MessageId { get; set; }

    /// <summary>The URL as it appeared in the body, after trimming punctuation.</summary>
    public required string Url { get; set; }

    public EmbedKind Kind { get; set; }

    /// <summary>"youtube", "vimeo", or the host for a plain card.</summary>
    public required string Provider { get; set; }

    /// <summary>The video id a player needs; null for link cards.</summary>
    public string? ProviderId { get; set; }

    /// <summary>Where playback should start, in seconds.</summary>
    public int? StartSeconds { get; set; }

    public required string Domain { get; set; }
    public string? Title { get; set; }
    public string? Description { get; set; }

    /// <summary>
    /// The preview image, copied into our own storage. Serving the original
    /// from its host would tell that host who reads this channel and when,
    /// which a private server exists to avoid.
    /// </summary>
    public Guid? ThumbnailAttachmentId { get; set; }

    public ImageAttachment? ThumbnailAttachment { get; set; }

    /// <summary>Order within the message, since a body may carry several links.</summary>
    public int Position { get; set; }

    public DateTime CreatedAt { get; set; }
}
