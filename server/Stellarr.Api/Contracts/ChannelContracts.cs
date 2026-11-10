namespace Stellarr.Api.Contracts;

public sealed record CreateChannelRequest(string? Name, string? Kind, Guid? SectionId = null);

/// <summary>Every field is optional; a field left out keeps its value.</summary>
public sealed record UpdateChannelRequest(
    string? Name,
    string? Topic,
    int? SlowModeSeconds,
    int? HideAfterInactivityHours,
    string? AudioProfile,
    int? UserLimit);

public sealed record ReorderChannelsRequest(IReadOnlyList<Guid> ChannelIds);
