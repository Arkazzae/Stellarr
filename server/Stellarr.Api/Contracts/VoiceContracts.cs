namespace Stellarr.Api.Contracts;

/// <summary>
/// A message between the peers of a voice room, relayed untouched by the hub.
/// </summary>
/// <param name="ChannelId">The room: a voice channel or a direct conversation.</param>
/// <param name="ToUserId">The one peer it is meant for; null addresses everybody else in the room.</param>
/// <param name="Kind">One of <c>RtcProtocol.SignalKinds</c>.</param>
/// <param name="Payload">The kind's own JSON or SDP text, at most <c>RtcProtocol.MaxSignalBytes</c> long.</param>
public sealed record VoiceSignalDto(
    int ProtocolVersion,
    string ChannelId,
    string? ToUserId,
    string Kind,
    string Payload);

/// <summary>Where a moderator sends a member who is in a voice channel.</summary>
public sealed record MoveVoiceMemberRequest(Guid TargetChannelId);
