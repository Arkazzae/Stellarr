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

/// <summary>
/// A signal from a browser to the media server, in the sfu topology. The hub
/// checks it and hands it to the media server; it never reaches another
/// browser.
/// </summary>
/// <param name="ChannelId">The room the caller's seat is in: a voice channel or a direct conversation.</param>
/// <param name="SessionId">The caller's current media session, as <c>OpenMediaSession</c> returned it.</param>
/// <param name="Kind">One of <c>RtcProtocol.MediaSignalKinds</c>.</param>
/// <param name="Payload">The kind's JSON, at most <c>RtcProtocol.MaxSignalBytes</c> long.</param>
public sealed record MediaSignalDto(
    int ProtocolVersion,
    string ChannelId,
    string SessionId,
    string Kind,
    string Payload);

/// <summary>The answer to <c>OpenMediaSession</c>.</summary>
/// <param name="SessionId">Opaque; the client quotes it in every signal and drops anything that names another.</param>
public sealed record MediaSessionDto(string SessionId);

/// <summary>Where a moderator sends a member who is in a voice channel.</summary>
public sealed record MoveVoiceMemberRequest(Guid TargetChannelId);
