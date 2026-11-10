namespace Stellarr.Api.Contracts;

/// <summary>Everything a client needs to draw its first screen of one server.</summary>
/// <param name="Servers">All servers the caller belongs to, in the order they joined.</param>
/// <param name="Members">The members of <paramref name="Server"/>, with the presence the caller may see.</param>
/// <param name="Messages">The newest page of the first text channel, oldest first.</param>
/// <param name="ChannelReads">The caller's read marker of every text channel, by channel id.</param>
/// <param name="Voice">Who is in each voice channel, by channel id.</param>
/// <param name="Permissions">The wire names of the caller's privileges on <paramref name="Server"/>.</param>
public sealed record BootstrapDto(
    UserDto User,
    ServerDto Server,
    IReadOnlyList<ServerDto> Servers,
    IReadOnlyList<ChannelDto> Channels,
    IReadOnlyList<SectionDto> Sections,
    IReadOnlyList<UserDto> Members,
    IReadOnlyList<MessageDto> Messages,
    IReadOnlyDictionary<string, DateTime> ChannelReads,
    IReadOnlyDictionary<string, IReadOnlyList<VoiceOccupantDto>> Voice,
    RtcConfigurationDto Rtc,
    IReadOnlyList<string> Permissions);

public sealed record VoiceOccupantDto(string UserId, string DisplayName, bool Muted);

public sealed record RtcConfigurationDto(
    int ProtocolVersion,
    string Topology,
    RtcCapabilitiesDto Capabilities,
    IReadOnlyList<IceServerDto> IceServers,
    string SignalingHub,
    string MediaServer);

public sealed record RtcCapabilitiesDto(
    IReadOnlyList<string> AudioCodecs,
    IReadOnlyList<string> VideoCodecs,
    IReadOnlyList<string> AudioProcessing,
    bool Camera,
    bool ScreenShare,
    bool ScreenAudio);

public sealed record IceServerDto(IReadOnlyList<string> Urls, string? Username, string? Credential);
