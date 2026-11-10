namespace Stellarr.Api.Embeds;

/// <summary>Settings of link previews, bound from <c>Stellarr:Embeds</c>.</summary>
public sealed class EmbedOptions
{
    public const string SectionName = "Stellarr:Embeds";

    /// <summary>
    /// Switches outbound fetching off. YouTube and Vimeo links still become
    /// players, because recognising them takes no request, but no page is read
    /// and no card is built.
    /// </summary>
    public bool Enabled { get; set; } = true;

    /// <summary>How many links of one message get a card; the rest stay plain links.</summary>
    public int MaxPerMessage { get; set; } = 2;

    /// <summary>
    /// How long a host may take to answer a request. For a page or an image the
    /// deadline ends with the headers, so what a host sends after that is not
    /// bounded by it; YouTube's small oEmbed response is read under it entirely.
    /// </summary>
    public int TimeoutSeconds { get; set; } = 6;

    /// <summary>
    /// How much of a page is read. The tags that make a card sit in the head,
    /// so a page that has not said it by then is not going to.
    /// </summary>
    public int MaxHtmlBytes { get; set; } = 512 * 1024;

    public int MaxImageBytes { get; set; } = 2 * 1024 * 1024;

    public int MaxRedirects { get; set; } = 3;

    /// <summary>
    /// Lets the unfurler connect to loopback, link-local and private addresses.
    /// </summary>
    /// <remarks>
    /// Off is the security boundary. A message body is written by whoever can
    /// post, so an unfurler that follows it anywhere lets that person make this
    /// server open connections to everything else it can reach. Turn it on only
    /// to preview pages on your own network, and only if everyone who can post
    /// may probe that network.
    /// </remarks>
    public bool AllowPrivateNetworks { get; set; }

    /// <summary>Sent as <c>User-Agent</c>, so that the other end can recognise and block us.</summary>
    public string UserAgent { get; set; } = "StellarrBot/1.0 (+https://github.com/arkazz/stellarr)";
}
