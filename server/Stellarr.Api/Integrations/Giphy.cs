using System.Net;
using Stellarr.Api.Domain;
using Stellarr.Api.Secrets;

namespace Stellarr.Api.Integrations;

/// <summary>Whether the web client offers GIFs, and the key it uses for them.</summary>
public sealed record GiphyState(bool Enabled, string ApiKey)
{
    // A record prints its members; this one must never print the key.
    public override string ToString() => $"GiphyState {{ Enabled = {Enabled} }}";

    /// <summary>
    /// GIFs are on when a key is set and the operator has not turned them off.
    /// An installation that never chose (the flag is null) keeps them on while
    /// it has a key, as before the switch existed. Off, the key is not handed out.
    /// </summary>
    public static GiphyState Resolve(OperationsSettings? settings, ResolvedSecrets secrets)
    {
        var key = secrets.GiphyApiKey;
        var enabled = key.IsSet && (settings?.GiphyEnabled ?? true);
        return new GiphyState(enabled, enabled ? key.Value : "");
    }
}

/// <summary>What GIPHY answered when Cockpit tried a key.</summary>
public enum GiphyCheck
{
    Connected,
    KeyRefused,
    Unreachable,
}

/// <summary>Asks GIPHY whether a key works, with one small trending request.</summary>
public sealed class GiphyClient(HttpClient http)
{
    /// <returns>The verdict and, for a failure, what GIPHY answered or why it could not be asked.</returns>
    public async Task<(GiphyCheck Result, string Detail)> CheckAsync(string apiKey, CancellationToken cancellationToken)
    {
        var path = $"v1/gifs/trending?api_key={Uri.EscapeDataString(apiKey)}&limit=1&rating=g";
        try
        {
            using var response = await http.GetAsync(path, cancellationToken);
            return response.StatusCode switch
            {
                HttpStatusCode.OK => (GiphyCheck.Connected, ""),
                HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden =>
                    (GiphyCheck.KeyRefused, $"HTTP {(int)response.StatusCode}"),
                _ => (GiphyCheck.Unreachable, $"HTTP {(int)response.StatusCode}"),
            };
        }
        catch (HttpRequestException exception)
        {
            return (GiphyCheck.Unreachable, exception.Message);
        }
        catch (TaskCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            // HttpClient reports its own timeout as a cancellation.
            return (GiphyCheck.Unreachable, "timeout");
        }
    }
}
