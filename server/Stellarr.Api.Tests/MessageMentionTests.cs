using Stellarr.Api.Messaging;

namespace Stellarr.Api.Tests;

public sealed class MessageMentionTests
{
    [Theory]
    [InlineData("Hej @Ada", new[] { "ADA" })]
    [InlineData("@ada @ADA @Ada", new[] { "ADA" })]
    [InlineData("@maja i @jo-1, @ilya_x", new[] { "MAJA", "JO-1", "ILYA_X" })]
    [InlineData("(@ada)", new[] { "ADA" })]
    [InlineData("`kod` @ada", new[] { "ADA" })]
    [InlineData("```\ncode\n``` @ada", new[] { "ADA" })]
    [InlineData("@żaneta", new[] { "ŻANETA" })]
    public void NamesOutsideCodeAndLinksAreMentions(string content, string[] expected) =>
        Assert.Equal(expected.Order(), MessageMentions.ExtractNormalizedUsernames(content).Order());

    [Theory]
    [InlineData("`@ada`")]
    [InlineData("`@ada")]
    [InlineData("```\n@ada\n```")]
    [InlineData("```@ada")]
    [InlineData("<code>@ada</code>")]
    [InlineData("<CODE>@ada</Code>")]
    [InlineData("<code>@ada")]
    [InlineData("https://example.test/@ada")]
    [InlineData("HTTP://example.test/@ada")]
    [InlineData("maja@ada.pl")]
    [InlineData("@a")]
    [InlineData("@")]
    [InlineData("")]
    public void CodeLinksAddressesAndTooShortNamesAreNotMentions(string content) =>
        Assert.Empty(MessageMentions.ExtractNormalizedUsernames(content));

    [Fact]
    public void ANameEndsAfterThirtyTwoCharacters() =>
        Assert.Equal(
            [new string('X', 32)],
            MessageMentions.ExtractNormalizedUsernames($"@{new string('x', 40)}"));

    [Fact]
    public void ALinkEndsAtTheNextWhitespace() =>
        Assert.Equal(
            ["ADA"],
            MessageMentions.ExtractNormalizedUsernames("https://example.test/@jo\n@ada"));
}
