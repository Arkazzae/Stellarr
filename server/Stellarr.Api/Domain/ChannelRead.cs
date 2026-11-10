namespace Stellarr.Api.Domain;

/// <summary>A person's read watermark in one text channel.</summary>
public sealed class ChannelRead
{
    public Guid ChannelId { get; set; }
    public Guid UserId { get; set; }
    public DateTime LastReadAt { get; set; }
}
