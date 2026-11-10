using System.Diagnostics.CodeAnalysis;

namespace Stellarr.Api.Storage;

public enum UploadKind
{
    Image,
    Audio,
    Video,
    File,
}

/// <summary>What the instance stores a type as: its canonical media type, extension and folder.</summary>
public sealed record UploadSpec(UploadKind Kind, string ContentType, string Extension, string Folder);

/// <summary>Tells whether the first bytes of a file belong to the format it claims to be.</summary>
internal delegate bool SignatureCheck(ReadOnlySpan<byte> header);

/// <summary>
/// The allow-list of attachment types, each with the signature its file must
/// start with.
/// </summary>
/// <remarks>
/// The Content-Type of a multipart part is only a claim, so a file reaches
/// object storage only when its first bytes fit the container it declares.
/// That keeps executables and arbitrary data from being served from this
/// origin as media. Whether a browser can decode the codec inside is left to
/// the reader.
/// </remarks>
public static class AttachmentValidation
{
    private sealed record Rule(UploadSpec Spec, SignatureCheck Matches);

    private static readonly byte[] WebMSignature = [0x1A, 0x45, 0xDF, 0xA3];

    private static readonly Dictionary<string, Rule> Rules = BuildRules();

    /// <summary>
    /// Finds the spec for a declared media type. Parameters such as
    /// <c>; charset=utf-8</c> are ignored and an alias resolves to its
    /// canonical type.
    /// </summary>
    public static bool TryGetSpec(string declaredContentType, [NotNullWhen(true)] out UploadSpec? spec)
    {
        var mediaType = declaredContentType.Split(';', 2, StringSplitOptions.TrimEntries)[0];
        spec = Rules.TryGetValue(mediaType, out var rule) ? rule.Spec : null;
        return spec is not null;
    }

    public static bool MatchesSignature(UploadSpec spec, ReadOnlySpan<byte> header) =>
        Rules.TryGetValue(spec.ContentType, out var rule) && rule.Matches(header);

    public static long MaxBytes(UploadSpec spec, UploadOptions options) => spec.Kind switch
    {
        UploadKind.Image => options.MaxImageBytes,
        UploadKind.Audio => options.MaxAudioBytes,
        UploadKind.Video => options.MaxVideoBytes,
        UploadKind.File => options.MaxFileBytes,
        _ => 0,
    };

    private static Dictionary<string, Rule> BuildRules()
    {
        var rules = new Dictionary<string, Rule>(StringComparer.OrdinalIgnoreCase);

        void Define(
            UploadKind kind,
            string contentType,
            string extension,
            SignatureCheck matches,
            params string[] aliases)
        {
            var folder = kind switch
            {
                UploadKind.Image => "images",
                UploadKind.Audio => "audio",
                UploadKind.Video => "videos",
                _ => "files",
            };
            var rule = new Rule(new UploadSpec(kind, contentType, extension, folder), matches);
            rules[contentType] = rule;
            foreach (var alias in aliases)
            {
                rules[alias] = rule;
            }
        }

        void DefineImage(string contentType) => Define(
            UploadKind.Image,
            contentType,
            ImageValidation.ExtensionFor(contentType),
            header => ImageValidation.MatchesSignature(contentType, header));

        DefineImage("image/jpeg");
        DefineImage("image/png");
        DefineImage("image/gif");
        DefineImage("image/webp");

        Define(UploadKind.Audio, "audio/mpeg", ".mp3", IsMp3);
        Define(UploadKind.Audio, "audio/ogg", ".ogg", IsOgg);
        Define(UploadKind.Audio, "audio/wav", ".wav", IsWave, "audio/x-wav");
        Define(UploadKind.Audio, "audio/webm", ".webm", IsWebM);
        Define(UploadKind.Audio, "audio/mp4", ".m4a", IsIsoMedia, "audio/x-m4a");
        Define(UploadKind.Audio, "audio/aac", ".aac", IsAac);

        Define(UploadKind.Video, "video/mp4", ".mp4", IsIsoMedia, "video/x-m4v");
        Define(UploadKind.Video, "video/webm", ".webm", IsWebM);
        Define(UploadKind.Video, "video/ogg", ".ogv", IsOgg);
        Define(UploadKind.Video, "video/quicktime", ".mov", IsIsoMedia);

        Define(UploadKind.File, "application/pdf", ".pdf", IsPdf);
        Define(UploadKind.File, "application/zip", ".zip", IsZip, "application/x-zip-compressed");
        Define(UploadKind.File, "text/plain", ".txt", IsPlainText);
        Define(UploadKind.File, "application/json", ".json", IsJson);
        Define(
            UploadKind.File,
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            ".docx",
            IsZip);
        Define(
            UploadKind.File,
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            ".xlsx",
            IsZip);
        Define(
            UploadKind.File,
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            ".pptx",
            IsZip);

        return rules;
    }

    // An ID3 tag, or an MPEG audio frame: eleven set sync bits, then a layer
    // that is not the reserved one.
    private static bool IsMp3(ReadOnlySpan<byte> header) =>
        header.StartsWith("ID3"u8) ||
        (header.Length >= 2 && header[0] == 0xFF && (header[1] & 0xE6) == 0xE2);

    private static bool IsOgg(ReadOnlySpan<byte> header) => header.StartsWith("OggS"u8);

    private static bool IsWave(ReadOnlySpan<byte> header) =>
        header.Length >= 12 && header.StartsWith("RIFF"u8) && header[8..12].SequenceEqual("WAVE"u8);

    private static bool IsWebM(ReadOnlySpan<byte> header) =>
        header.StartsWith(WebMSignature);

    // MP4, M4A and QuickTime share the ISO base media layout: a box size, then "ftyp".
    private static bool IsIsoMedia(ReadOnlySpan<byte> header) =>
        header.Length >= 12 && header[4..8].SequenceEqual("ftyp"u8);

    // An ADTS frame header: twelve set sync bits, then layer bits that must be zero.
    private static bool IsAac(ReadOnlySpan<byte> header) =>
        header.Length >= 2 && header[0] == 0xFF && (header[1] & 0xF6) == 0xF0;

    private static bool IsPdf(ReadOnlySpan<byte> header) => header.StartsWith("%PDF-"u8);

    // A local file header, an empty archive or a spanned archive marker.
    private static bool IsZip(ReadOnlySpan<byte> header) =>
        header.Length >= 4 &&
        header[0] == (byte)'P' &&
        header[1] == (byte)'K' &&
        ((header[2], header[3]) is (3, 4) or (5, 6) or (7, 8));

    private static bool IsPlainText(ReadOnlySpan<byte> header) =>
        header.Length > 0 && !header.Contains((byte)0);

    private static bool IsJson(ReadOnlySpan<byte> header)
    {
        if (!IsPlainText(header))
        {
            return false;
        }

        foreach (var value in header)
        {
            if (value is (byte)' ' or (byte)'\t' or (byte)'\r' or (byte)'\n')
            {
                continue;
            }

            return value is (byte)'{' or (byte)'[';
        }

        return false;
    }
}
