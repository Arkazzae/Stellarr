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

    public static readonly FrozenSet<string> SignalKinds =
        new[] { "offer", "answer", "candidate", "state" }.ToFrozenSet(StringComparer.Ordinal);
}
