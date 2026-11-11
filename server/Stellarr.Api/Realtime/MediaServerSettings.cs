namespace Stellarr.Api.Realtime;

/// <summary>
/// Where the API finds Stellarr Media, the media server every voice room goes
/// through: the address and secret of its control API, and the public UDP
/// port browsers send media to.
/// </summary>
/// <remarks>
/// Read once, at start. A value the API cannot use stops it there instead of
/// leaving voice half configured.
/// </remarks>
public sealed class MediaServerSettings
{
    private const string DefaultControlUrl = "http://127.0.0.1:5200";
    private const int DefaultMediaPort = 49000;

    private MediaServerSettings(Uri controlUrl, string controlSecret, int mediaPort)
    {
        ControlUrl = controlUrl;
        ControlSecret = controlSecret;
        MediaPort = mediaPort;
    }

    /// <summary>The base address of the control API, such as <c>http://127.0.0.1:5200/</c>.</summary>
    public Uri ControlUrl { get; }

    /// <summary>The bearer secret of the control API; empty when the media server runs without one.</summary>
    public string ControlSecret { get; }

    /// <summary>The public UDP port of the media server, named in the bootstrap's <c>mediaServer</c>.</summary>
    public int MediaPort { get; }

    /// <summary>
    /// Reads <c>Rtc:MediaControlUrl</c>, <c>Rtc:MediaControlSecret</c> and
    /// <c>Rtc:MediaPort</c>. An unusable value stops the API at start.
    /// </summary>
    /// <exception cref="InvalidOperationException">A setting has a value the API cannot use.</exception>
    public static MediaServerSettings Load(IConfiguration configuration)
    {
        var controlUrl = configuration["Rtc:MediaControlUrl"];
        if (!Uri.TryCreate(
                string.IsNullOrWhiteSpace(controlUrl) ? DefaultControlUrl : controlUrl.Trim(),
                UriKind.Absolute,
                out var control) ||
            (control.Scheme != Uri.UriSchemeHttp && control.Scheme != Uri.UriSchemeHttps))
        {
            throw new InvalidOperationException("Rtc:MediaControlUrl must be an absolute http or https address.");
        }

        var mediaPort = configuration.GetValue("Rtc:MediaPort", DefaultMediaPort);
        if (mediaPort is < 1 or > 65535)
        {
            throw new InvalidOperationException("Rtc:MediaPort must be between 1 and 65535.");
        }

        // The routes of the control API are relative, so the base has to end
        // with a slash or its last segment would be replaced.
        var baseAddress = control.AbsoluteUri.EndsWith('/') ? control : new Uri(control.AbsoluteUri + "/");
        return new MediaServerSettings(baseAddress, configuration["Rtc:MediaControlSecret"]?.Trim() ?? "", mediaPort);
    }

    /// <summary>
    /// The public media endpoint the bootstrap names. It is diagnostic only: a
    /// browser connects to the candidates in the SDP, never to this address.
    /// </summary>
    public string PublicEndpoint(string host) => $"udp://{host}:{MediaPort}";
}
