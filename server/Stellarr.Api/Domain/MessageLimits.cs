namespace Stellarr.Api.Domain;

/// <summary>One content contract for channel messages, edits and direct messages.</summary>
public static class MessageLimits
{
    /// <summary>
    /// Room for a pasted listing, yet bounded for storage, realtime fan-out
    /// and transcript rendering.
    /// </summary>
    public const int MaxContentLength = 20_000;

    /// <summary>
    /// A voice note is a quick message, not an open-ended recording. The web
    /// recorder mirrors this limit; the API stays authoritative.
    /// </summary>
    public const double MaxVoiceMessageDurationSeconds = 10 * 60;
}
