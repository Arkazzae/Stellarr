namespace Stellarr.Api.Domain;

public enum ChannelKind
{
    Text = 0,
    Voice = 1,
}

public sealed class Channel
{
    public Guid Id { get; set; }
    public Guid ServerId { get; set; }
    public required string Name { get; set; }
    public ChannelKind Kind { get; set; }
    public int Position { get; set; }
    public string Topic { get; set; } = "";
    public int SlowModeSeconds { get; set; }
    public int HideAfterInactivityHours { get; set; }
    public string AudioProfile { get; set; } = "premium";
    public int UserLimit { get; set; }

    /// <summary>The collapsible rail group this channel sits under, or null when it has none.</summary>
    public Guid? SectionId { get; set; }
}
