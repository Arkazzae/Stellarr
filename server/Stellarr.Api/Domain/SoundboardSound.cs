namespace Stellarr.Api.Domain;

/// <summary>
/// A short audio clip, trimmed without altering the stored file, that is
/// available in every voice channel of one server.
/// </summary>
public sealed class SoundboardSound
{
    public Guid Id { get; set; }
    public Guid ServerId { get; set; }
    public Guid AttachmentId { get; set; }
    public Guid CreatedById { get; set; }
    public required string Name { get; set; }
    public required string Glyph { get; set; }
    public double TrimStartSeconds { get; set; }
    public double TrimEndSeconds { get; set; }
    public int Position { get; set; }
    public DateTime CreatedAt { get; set; }

    public StellarrServer Server { get; set; } = null!;
    public ImageAttachment Attachment { get; set; } = null!;
}
