using System.Collections.Frozen;

namespace Stellarr.Api.Realtime;

/// <summary>
/// The contract of voice signalling that the client bootstrap and the hub
/// share. <see cref="Version"/> only changes with an incompatible change.
/// </summary>
public static class RtcProtocol
{
    public const int Version = 1;

    /// <summary>The largest signal payload, in bytes, that the hub relays.</summary>
    public const int MaxSignalBytes = 128 * 1024;

    /// <summary>
    /// What a browser may send the others in its room with
    /// <c>SendVoiceSignal</c>: only its <c>state</c>. Media and its negotiation
    /// go through the media server (<see cref="MediaSignalKinds"/>), so browsers
    /// never connect to each other and never learn each other's addresses.
    /// </summary>
    public static readonly FrozenSet<string> SignalKinds =
        new[] { "state" }.ToFrozenSet(StringComparer.Ordinal);

    /// <summary>What a browser may send the media server with <c>SendMediaSignal</c>.</summary>
    public static readonly FrozenSet<string> MediaSignalKinds =
        new[] { "offer", "answer", "candidate" }.ToFrozenSet(StringComparer.Ordinal);

    /// <summary>What the media server may send a browser as <c>MediaSignal</c>.</summary>
    public static readonly FrozenSet<string> MediaServerSignalKinds =
        new[] { "offer", "answer", "tracks" }.ToFrozenSet(StringComparer.Ordinal);
}
