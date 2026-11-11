namespace Stellarr.Api.Realtime;

/// <summary>
/// How voice media travels on this instance: browser to browser (<c>mesh</c>)
/// or through Stellarr Media (<c>sfu</c>), and where the API finds the media
/// server's control API in the second case.
/// </summary>
/// <remarks>
/// One instance has one topology, chosen at start. In the mesh topology the
/// settings of the media server are not read, so a mesh deployment never fails
/// because of them, and the API never calls the media server.
/// </remarks>
public sealed class MediaTopology
{
    public const string Mesh = "mesh";
    public const string Sfu = "sfu";

    private const string DefaultControlUrl = "http://127.0.0.1:5200";
    private const int DefaultMediaPort = 49000;

    private MediaTopology(string name, Uri controlUrl, string controlSecret, int mediaPort)
    {
        Name = name;
        ControlUrl = controlUrl;
        ControlSecret = controlSecret;
        MediaPort = mediaPort;
    }

    /// <summary>The configured value, which the bootstrap reports as <c>topology</c>.</summary>
    public string Name { get; }

    public bool IsSfu => Name == Sfu;

    /// <summary>The base address of the control API, such as <c>http://127.0.0.1:5200/</c>.</summary>
    public Uri ControlUrl { get; }

    /// <summary>The bearer secret of the control API; empty when the media server runs without one.</summary>
    public string ControlSecret { get; }

    /// <summary>The public UDP port of the media server, named in the bootstrap's <c>mediaServer</c>.</summary>
    public int MediaPort { get; }

    /// <summary>
    /// Reads <c>Rtc:Topology</c> and, in the sfu topology, the settings of the
    /// media server. An unknown topology or an unusable setting stops the API
    /// at start instead of leaving voice half configured.
    /// </summary>
    /// <exception cref="InvalidOperationException">A setting has a value the API cannot use.</exception>
    public static MediaTopology Load(IConfiguration configuration)
    {
        // Compose passes an unset variable on as an empty value, which is the
        // same as not choosing a topology at all.
        var configured = configuration["Rtc:Topology"];
        var name = string.IsNullOrWhiteSpace(configured) ? Mesh : configured;
        if (name == Mesh)
        {
            return new MediaTopology(Mesh, new Uri(DefaultControlUrl), "", DefaultMediaPort);
        }

        if (name != Sfu)
        {
            throw new InvalidOperationException(
                $"Rtc:Topology must be \"{Mesh}\" or \"{Sfu}\", not \"{configured}\".");
        }

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
        return new MediaTopology(Sfu, baseAddress, configuration["Rtc:MediaControlSecret"]?.Trim() ?? "", mediaPort);
    }

    /// <summary>
    /// The public media endpoint the bootstrap names. It is diagnostic only: a
    /// browser connects to the candidates in the SDP, never to this address.
    /// </summary>
    public string PublicEndpoint(string host) => IsSfu ? $"udp://{host}:{MediaPort}" : "";
}
