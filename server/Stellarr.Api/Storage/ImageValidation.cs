namespace Stellarr.Api.Storage;

/// <summary>The image formats Stellarr accepts, with the bytes that identify each.</summary>
public static class ImageValidation
{
    private sealed record ImageType(string Extension, SignatureCheck Matches);

    private static readonly byte[] JpegSignature = [0xFF, 0xD8, 0xFF];
    private static readonly byte[] PngSignature = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

    private static readonly Dictionary<string, ImageType> Types = new(StringComparer.OrdinalIgnoreCase)
    {
        ["image/jpeg"] = new(".jpg", header => header.StartsWith(JpegSignature)),
        ["image/png"] = new(".png", header => header.StartsWith(PngSignature)),
        ["image/gif"] = new(".gif", header => header.StartsWith("GIF87a"u8) || header.StartsWith("GIF89a"u8)),
        ["image/webp"] = new(
            ".webp",
            header => header.Length >= 12 && header.StartsWith("RIFF"u8) && header[8..12].SequenceEqual("WEBP"u8)),
    };

    public static bool IsAllowedContentType(string contentType) => Types.ContainsKey(contentType);

    public static bool MatchesSignature(string contentType, ReadOnlySpan<byte> header) =>
        Types.TryGetValue(contentType, out var type) && type.Matches(header);

    public static string ExtensionFor(string contentType) =>
        Types.TryGetValue(contentType, out var type)
            ? type.Extension
            : throw new ArgumentOutOfRangeException(nameof(contentType));
}
