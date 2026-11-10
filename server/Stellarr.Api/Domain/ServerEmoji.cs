namespace Stellarr.Api.Domain;

/// <summary>An image emoji that every channel of one server can use.</summary>
public sealed class ServerEmoji
{
    public Guid Id { get; set; }
    public Guid ServerId { get; set; }

    /// <summary>Lowercase code without the surrounding colons.</summary>
    public required string Shortcode { get; set; }

    public required string ObjectKey { get; set; }
    public required string ContentType { get; set; }
    public long SizeBytes { get; set; }
    public Guid UploadedById { get; set; }
    public DateTime CreatedAt { get; set; }
}
