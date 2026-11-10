using Stellarr.Api.Domain;

namespace Stellarr.Api.Contracts;

/// <param name="Shortcode">The code with its colons, as a message spells it.</param>
/// <param name="Glyph">Where the image is served from; clients render it in place of a character.</param>
public sealed record ServerEmojiDto(string Id, string Shortcode, string Glyph);

public static class EmojiContractMappings
{
    public static ServerEmojiDto ToDto(this ServerEmoji emoji) => new(
        emoji.Id.ToString(),
        $":{emoji.Shortcode}:",
        $"/api/emoji/{emoji.Id}/image?serverId={emoji.ServerId}");
}
