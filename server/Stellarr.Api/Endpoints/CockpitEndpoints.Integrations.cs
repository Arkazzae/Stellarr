using Stellarr.Api.Integrations;
using Stellarr.Api.Localization;
using Stellarr.Api.Secrets;

namespace Stellarr.Api.Endpoints;

// Checks of the outside services the instance connects to.
public static partial class CockpitEndpoints
{
    /// <summary>Tries the GIPHY key with one small request, so the operator knows it works before users see GIFs.</summary>
    private static async Task<IResult> TestGiphyAsync(
        InstanceSecrets secrets,
        GiphyClient giphy,
        Messages messages,
        CancellationToken cancellationToken)
    {
        var key = (await secrets.ReadAsync(cancellationToken)).GiphyApiKey;
        if (!key.IsSet)
        {
            return Results.Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: messages.Get(MessageKey.CockpitGiphyKeyMissing));
        }

        var (result, detail) = await giphy.CheckAsync(key.Value, cancellationToken);
        if (result == GiphyCheck.Connected)
        {
            return Results.Ok(new { connected = true });
        }

        // The panel shows the detail, so it carries the whole sentence.
        var sentence = messages.Get(
            result == GiphyCheck.KeyRefused ? MessageKey.CockpitGiphyKeyRefused : MessageKey.CockpitGiphyUnreachable,
            ("reason", detail));
        return Results.Problem(statusCode: StatusCodes.Status502BadGateway, title: sentence, detail: sentence);
    }
}
