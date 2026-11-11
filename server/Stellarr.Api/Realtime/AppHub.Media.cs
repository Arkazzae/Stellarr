using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.SignalR;
using Stellarr.Api.Auth;
using Stellarr.Api.Contracts;
using Stellarr.Api.Logging;

namespace Stellarr.Api.Realtime;

/// <summary>
/// The hub leg of the sfu topology: a browser opens a media session for its
/// seat and exchanges signals with the media server through the hub, which
/// decides who may do so. The media server trusts the hub and nobody else.
/// </summary>
public sealed partial class AppHub
{
    private const string MediaNotEnabled = "Media server is not enabled.";
    private const string MediaUnavailable = "Media server is unavailable.";
    private const string InvalidMediaSignal = "Invalid media signal.";
    private const string NotSeated = "Not seated in this voice room.";

    /// <summary>
    /// Creates the media session of the caller's seat in
    /// <paramref name="channelId"/>. A session the connection already had is
    /// closed first, silently.
    /// </summary>
    public async Task<MediaSessionDto> OpenMediaSession(string channelId)
    {
        RequireMediaServer();
        var roomId = ParseGuid(channelId, nameof(channelId));
        if (!presence.IsConnectionInVoice(Context.ConnectionId, roomId))
        {
            throw new HubException(NotSeated);
        }

        var opening = await mediaPlane.OpenAsync(Context.ConnectionId, roomId, Context.User!.RequireUserId());
        return opening.Status switch
        {
            MediaOpeningStatus.Opened => new MediaSessionDto(opening.SessionId!),
            MediaOpeningStatus.NotSeated => throw new HubException(NotSeated),
            _ => throw new HubException(MediaUnavailable),
        };
    }

    /// <summary>
    /// Hands one signal of the caller's media session to the media server. The
    /// call returns once the media server has taken it, which keeps the
    /// signals of one browser in the order it sent them.
    /// </summary>
    public async Task SendMediaSignal(MediaSignalDto signal)
    {
        RequireMediaServer();
        if (signal is null)
        {
            throw new HubException(InvalidMediaSignal);
        }

        var roomId = ParseGuid(signal.ChannelId, nameof(signal.ChannelId));
        // Holding the seat and the session in one look: the session of a seat
        // in another room, of another connection or of an earlier attempt is
        // not this caller's to use.
        if (signal.ProtocolVersion != RtcProtocol.Version ||
            signal.Kind is null ||
            !RtcProtocol.MediaSignalKinds.Contains(signal.Kind) ||
            signal.Payload is null ||
            Encoding.UTF8.GetByteCount(signal.Payload) > RtcProtocol.MaxSignalBytes ||
            presence.MediaSessionOf(Context.ConnectionId, roomId) is not { } session ||
            session.SessionId != signal.SessionId)
        {
            throw new HubException(InvalidMediaSignal);
        }

        MediaSignalOutcome outcome;
        try
        {
            outcome = await ForwardMediaSignalAsync(session.SessionId, signal.Kind, signal.Payload);
        }
        catch (MediaServerUnavailableException exception)
        {
            MediaLog.SignalFailed(logger, exception);
            throw new HubException(MediaUnavailable);
        }

        switch (outcome)
        {
            case MediaSignalOutcome.UnknownSession:
                // The media server lost the session, most likely in a restart
                // the event pump has not noticed yet. The browser replaces it.
                mediaPlane.LoseSession(session.SessionId);
                break;
            case MediaSignalOutcome.Refused:
                throw new HubException(InvalidMediaSignal);
            default:
                // A stale answer lost a race with a newer offer of the media
                // server, which drops it by design; the browser answers that
                // offer next.
                break;
        }
    }

    private void RequireMediaServer()
    {
        if (!mediaTopology.IsSfu)
        {
            throw new HubException(MediaNotEnabled);
        }
    }

    /// <summary>
    /// Turns the browser's payload into the body of the control API. A payload
    /// that is not what its kind promises is refused here and never reaches
    /// the media server.
    /// </summary>
    private async Task<MediaSignalOutcome> ForwardMediaSignalAsync(string sessionId, string kind, string payload)
    {
        using var document = ParseMediaPayload(payload);
        var root = document.RootElement;
        switch (kind)
        {
            case "offer" when IsDescription(root, "offer", out var sdp):
                return await mediaControl.SendOfferAsync(sessionId, sdp, CancellationToken.None);
            case "answer" when IsDescription(root, "answer", out var sdp) &&
                root.TryGetProperty("negotiationId", out var negotiation) &&
                negotiation.ValueKind == JsonValueKind.Number &&
                negotiation.TryGetInt64(out var negotiationId):
                return await mediaControl.SendAnswerAsync(sessionId, sdp, negotiationId, CancellationToken.None);
            case "candidate" when root.ValueKind == JsonValueKind.Null:
                return await mediaControl.SendCandidateAsync(sessionId, null, CancellationToken.None);
            case "candidate" when root.ValueKind == JsonValueKind.Object:
                return await mediaControl.SendCandidateAsync(sessionId, root, CancellationToken.None);
            default:
                throw new HubException(InvalidMediaSignal);
        }
    }

    private static JsonDocument ParseMediaPayload(string payload)
    {
        try
        {
            return JsonDocument.Parse(payload);
        }
        catch (JsonException)
        {
            throw new HubException(InvalidMediaSignal);
        }
    }

    /// <summary>An <c>{ "type", "sdp" }</c> object whose type is <paramref name="type"/>.</summary>
    private static bool IsDescription(JsonElement root, string type, out string sdp)
    {
        sdp = "";
        if (root.ValueKind != JsonValueKind.Object ||
            !root.TryGetProperty("type", out var declared) ||
            declared.ValueKind != JsonValueKind.String ||
            declared.GetString() != type ||
            !root.TryGetProperty("sdp", out var description) ||
            description.ValueKind != JsonValueKind.String)
        {
            return false;
        }

        sdp = description.GetString()!;
        return true;
    }
}
