using System.Diagnostics;
using System.Net;
using Stellarr.Api.Embeds;

namespace Stellarr.Api.Tests;

public sealed class EmbedParsingRobustnessTests
{
    private static readonly Uri Page = new("https://example.org/");

    [Fact]
    public void ReadsTagsWhateverTheirQuotingAndOrder()
    {
        var card = OpenGraph.Parse(
            """
            <html><head>
            <META content='Quoted with a space' PROPERTY=og:title>
            <meta name = "description"
                  content="Spread over lines">
            <meta property="og:image:secure_url" content="https://cdn.example/a.png">
            <meta property="og:image" content="https://cdn.example/b.png">
            </head></html>
            """,
            Page);

        Assert.Equal("Quoted with a space", card.Title);
        Assert.Equal("Spread over lines", card.Description);
        Assert.Equal("https://cdn.example/a.png", card.ImageUrl);
    }

    [Fact]
    public void TakesTheHeadToEndOnlyAtItsClosingTag()
    {
        var card = OpenGraph.Parse(
            """
            <header></header>
            <meta property="og:title" content="Before">
            </head >
            <meta property="og:description" content="After">
            """,
            Page);

        // The header element is not the head, and a closing tag may have a space in it.
        Assert.Equal("Before", card.Title);
        Assert.Null(card.Description);
    }

    [Theory]
    [InlineData("<meta ")]
    [InlineData("<title ")]
    [InlineData("<meta content=\"")]
    [InlineData("<meta a=b ")]
    public void AnUnfinishedPageCostsTimeInProportionToItsSize(string fragment)
    {
        var html = string.Concat(Enumerable.Repeat(fragment, 500 * 1024 / fragment.Length));
        var clock = Stopwatch.StartNew();

        OpenGraph.Parse(html, Page);

        Assert.True(clock.Elapsed < TimeSpan.FromSeconds(5), $"took {clock.Elapsed}");
    }

    [Fact]
    public void NeverCutsAMultiUnitCharacterInHalf()
    {
        var card = OpenGraph.Parse(
            $"""<head><meta property="og:title" content="{new string('a', 199)}😀 and more"></head>""",
            Page);

        // A lone surrogate could not be written to JSON.
        Assert.Equal(new string('a', 199) + "…", card.Title);
    }

    [Theory]
    [InlineData("https://www.youtube.com/watch?v=eRsGyueVLvQ&t=99999999999999999999s")]
    [InlineData("https://www.youtube.com/watch?v=eRsGyueVLvQ&t=25h")]
    [InlineData("https://www.youtube.com/watch?v=eRsGyueVLvQ&t=soon")]
    public void IgnoresAStartTimeThatIsNotAReasonableOne(string url)
    {
        Assert.True(VideoLinks.TryParse(new Uri(url), out var link));
        Assert.Null(link.StartSeconds);
    }

    [Theory]
    [InlineData("192.0.2.1")]
    [InlineData("198.18.0.1")]
    [InlineData("198.51.100.1")]
    [InlineData("203.0.113.1")]
    [InlineData("192.88.99.1")]
    [InlineData("240.0.0.1")]
    [InlineData("::")]
    [InlineData("100::1")]
    [InlineData("2002::1")]
    public void RefusesTheReservedRangesTheSpecDoesNotListEither(string address)
    {
        Assert.False(PublicAddress.IsPublic(IPAddress.Parse(address)));
    }

    [Fact]
    public void AllowsAnAddressInTheNat64Prefix()
    {
        Assert.True(PublicAddress.IsPublic(IPAddress.Parse("64:ff9b::808:808")));
    }
}
