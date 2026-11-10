namespace Stellarr.Api.Domain;

/// <summary>
/// One uploaded object. Despite the name it also holds audio, video and plain
/// files; the name is kept because it is the table existing installations use.
/// </summary>
public sealed class ImageAttachment
{
    public Guid Id { get; set; }
    public Guid UploadedById { get; set; }
    public required string ObjectKey { get; set; }
    public required string FileName { get; set; }
    public required string ContentType { get; set; }
    public long SizeBytes { get; set; }
    public int? Width { get; set; }
    public int? Height { get; set; }

    /// <summary>Measured playback length of audio and video, in seconds.</summary>
    public double? DurationSeconds { get; set; }

    /// <summary>
    /// True only for audio recorded by the message composer. Uploaded audio
    /// stays a file attachment even when it happens to be speech.
    /// </summary>
    public bool IsVoiceMessage { get; set; }

    /// <summary>A small frame taken from an uploaded video.</summary>
    public string? PosterObjectKey { get; set; }

    public string? PosterContentType { get; set; }
    public long? PosterSizeBytes { get; set; }
    public DateTime CreatedAt { get; set; }
}

public sealed class MessageAttachment
{
    public Guid MessageId { get; set; }
    public Guid AttachmentId { get; set; }
    public ImageAttachment Attachment { get; set; } = null!;
}
