using Stellarr.Api.Storage;

namespace Stellarr.Api.Tests;

public sealed class AttachmentValidationTests
{
    private static readonly byte[] Png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0];
    private static readonly byte[] Jpeg = [0xFF, 0xD8, 0xFF, 0xE0, 0, 0];
    private static readonly byte[] Gif = "GIF89a\0\0"u8.ToArray();
    private static readonly byte[] Webp = "RIFF\0\0\0\0WEBPVP8 "u8.ToArray();
    private static readonly byte[] Wave = "RIFF\0\0\0\0WAVEfmt "u8.ToArray();
    private static readonly byte[] IsoMedia = [0, 0, 0, 16, (byte)'f', (byte)'t', (byte)'y', (byte)'p', 1, 2, 3, 4];
    private static readonly byte[] WebM = [0x1A, 0x45, 0xDF, 0xA3, 0, 0];
    private static readonly byte[] Zip = [(byte)'P', (byte)'K', 3, 4, 0, 0];

    private static UploadSpec SpecFor(string contentType) =>
        AttachmentValidation.TryGetSpec(contentType, out var spec)
            ? spec
            : throw new InvalidOperationException($"{contentType} is not an accepted type.");

    public static TheoryData<string, UploadKind, string, string> KnownTypes => new()
    {
        { "image/jpeg", UploadKind.Image, "images", ".jpg" },
        { "image/png", UploadKind.Image, "images", ".png" },
        { "image/gif", UploadKind.Image, "images", ".gif" },
        { "image/webp", UploadKind.Image, "images", ".webp" },
        { "audio/mpeg", UploadKind.Audio, "audio", ".mp3" },
        { "audio/ogg", UploadKind.Audio, "audio", ".ogg" },
        { "audio/wav", UploadKind.Audio, "audio", ".wav" },
        { "audio/webm", UploadKind.Audio, "audio", ".webm" },
        { "audio/mp4", UploadKind.Audio, "audio", ".m4a" },
        { "audio/aac", UploadKind.Audio, "audio", ".aac" },
        { "video/mp4", UploadKind.Video, "videos", ".mp4" },
        { "video/webm", UploadKind.Video, "videos", ".webm" },
        { "video/ogg", UploadKind.Video, "videos", ".ogv" },
        { "video/quicktime", UploadKind.Video, "videos", ".mov" },
        { "application/pdf", UploadKind.File, "files", ".pdf" },
        { "application/zip", UploadKind.File, "files", ".zip" },
        { "text/plain", UploadKind.File, "files", ".txt" },
        { "application/json", UploadKind.File, "files", ".json" },
        {
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            UploadKind.File, "files", ".docx"
        },
        {
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            UploadKind.File, "files", ".xlsx"
        },
        {
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            UploadKind.File, "files", ".pptx"
        },
    };

    [Theory]
    [MemberData(nameof(KnownTypes))]
    public void DeclaredTypesMapToTheirKindFolderAndExtension(
        string contentType, UploadKind kind, string folder, string extension)
    {
        var spec = SpecFor(contentType);

        Assert.Equal(contentType, spec.ContentType);
        Assert.Equal(kind, spec.Kind);
        Assert.Equal(folder, spec.Folder);
        Assert.Equal(extension, spec.Extension);
    }

    [Theory]
    [InlineData("audio/x-wav", "audio/wav")]
    [InlineData("audio/x-m4a", "audio/mp4")]
    [InlineData("video/x-m4v", "video/mp4")]
    [InlineData("application/x-zip-compressed", "application/zip")]
    [InlineData("IMAGE/PNG", "image/png")]
    [InlineData("text/plain; charset=utf-8", "text/plain")]
    [InlineData("  application/json ;charset=utf-8", "application/json")]
    public void AliasesCaseAndParametersResolveToTheCanonicalType(string declared, string canonical)
    {
        Assert.Equal(canonical, SpecFor(declared).ContentType);
    }

    [Theory]
    [InlineData("")]
    [InlineData("image/svg+xml")]
    [InlineData("text/html")]
    [InlineData("application/x-msdownload")]
    [InlineData("application/octet-stream")]
    [InlineData("image")]
    public void UnknownTypesAreRefused(string declared)
    {
        Assert.False(AttachmentValidation.TryGetSpec(declared, out var spec));

        Assert.Null(spec);
    }

    public static TheoryData<string, byte[]> MatchingHeaders => new()
    {
        { "image/jpeg", Jpeg },
        { "image/png", Png },
        { "image/gif", Gif },
        { "image/webp", Webp },
        { "audio/mpeg", "ID3\u0004\0"u8.ToArray() },
        { "audio/mpeg", [0xFF, 0xFB, 0x90, 0x00] },
        { "audio/ogg", "OggS\0\0"u8.ToArray() },
        { "audio/wav", Wave },
        { "audio/webm", WebM },
        { "audio/mp4", IsoMedia },
        { "audio/aac", [0xFF, 0xF1, 0x50, 0x80] },
        { "video/mp4", IsoMedia },
        { "video/webm", WebM },
        { "video/ogg", "OggS\0\0"u8.ToArray() },
        { "video/quicktime", IsoMedia },
        { "application/pdf", "%PDF-1.7\n"u8.ToArray() },
        { "application/zip", Zip },
        { "application/zip", [(byte)'P', (byte)'K', 5, 6] },
        { "text/plain", "hello"u8.ToArray() },
        { "application/json", "  \r\n\t{\"a\":1}"u8.ToArray() },
        { "application/json", "[1]"u8.ToArray() },
        { "application/vnd.openxmlformats-officedocument.wordprocessingml.document", Zip },
        { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", Zip },
        { "application/vnd.openxmlformats-officedocument.presentationml.presentation", Zip },
    };

    [Theory]
    [MemberData(nameof(MatchingHeaders))]
    public void ABodyThatStartsLikeItsDeclaredTypeIsAccepted(string contentType, byte[] header)
    {
        Assert.True(AttachmentValidation.MatchesSignature(SpecFor(contentType), header));
    }

    public static TheoryData<string, byte[]> ForeignHeaders => new()
    {
        { "image/png", Jpeg },
        { "image/jpeg", Png },
        { "image/gif", "GIF90a"u8.ToArray() },
        { "image/webp", Wave },
        { "audio/mpeg", "not really an mp3"u8.ToArray() },
        { "audio/mpeg", [0xFF, 0xE0] },
        { "audio/ogg", "OGGS"u8.ToArray() },
        { "audio/wav", Webp },
        { "audio/webm", Zip },
        { "audio/mp4", [0, 0, 0, 16, (byte)'f', (byte)'t', (byte)'y'] },
        { "audio/aac", [0xFF, 0xFB] },
        { "video/mp4", WebM },
        { "application/pdf", "PDF-1.7 and more"u8.ToArray() },
        { "application/zip", [(byte)'P', (byte)'K', 1, 2] },
        { "application/zip", [(byte)'P', (byte)'K'] },
        { "text/plain", [0x68, 0x00, 0x69] },
        { "text/plain", Array.Empty<byte>() },
        { "application/json", "plain words"u8.ToArray() },
        { "application/json", "   \n"u8.ToArray() },
        { "application/json", "{\0}"u8.ToArray() },
        { "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "%PDF-"u8.ToArray() },
    };

    [Theory]
    [MemberData(nameof(ForeignHeaders))]
    public void ABodyThatDoesNotStartLikeItsDeclaredTypeIsRefused(string contentType, byte[] header)
    {
        Assert.False(AttachmentValidation.MatchesSignature(SpecFor(contentType), header));
    }

    [Fact]
    public void AnAliasIsCheckedAgainstTheSignatureOfItsCanonicalType()
    {
        var spec = SpecFor("audio/x-wav");

        Assert.True(AttachmentValidation.MatchesSignature(spec, Wave));
        Assert.False(AttachmentValidation.MatchesSignature(spec, Png));
    }

    [Fact]
    public void SizeLimitsComeFromTheUploadOptionsOfEachKind()
    {
        var options = new UploadOptions
        {
            MaxImageBytes = 1,
            MaxAudioBytes = 2,
            MaxVideoBytes = 3,
            MaxFileBytes = 4,
        };

        long Limit(string contentType) => AttachmentValidation.MaxBytes(SpecFor(contentType), options);

        Assert.Equal(1, Limit("image/png"));
        Assert.Equal(2, Limit("audio/ogg"));
        Assert.Equal(3, Limit("video/webm"));
        Assert.Equal(4, Limit("application/pdf"));
        Assert.Equal(4, Limit("application/json"));
    }

    [Fact]
    public void DefaultLimitsLeaveRoomForVideoAndKeepImagesSmall()
    {
        var options = new UploadOptions();

        Assert.Equal(10L * 1024 * 1024, options.MaxImageBytes);
        Assert.Equal(25L * 1024 * 1024, options.MaxAudioBytes);
        Assert.Equal(100L * 1024 * 1024, options.MaxVideoBytes);
        Assert.Equal(25L * 1024 * 1024, options.MaxFileBytes);
    }

    [Theory]
    [InlineData("image/png", ".png", true)]
    [InlineData("IMAGE/JPEG", ".jpg", true)]
    [InlineData("image/gif", ".gif", true)]
    [InlineData("image/webp", ".webp", true)]
    [InlineData("image/svg+xml", null, false)]
    [InlineData("audio/mpeg", null, false)]
    public void ImagesAreRecognisedByTypeAndGetTheirExtension(string contentType, string? extension, bool allowed)
    {
        Assert.Equal(allowed, ImageValidation.IsAllowedContentType(contentType));

        if (extension is null)
        {
            Assert.Throws<ArgumentOutOfRangeException>(() => ImageValidation.ExtensionFor(contentType));
        }
        else
        {
            Assert.Equal(extension, ImageValidation.ExtensionFor(contentType));
        }
    }

    [Fact]
    public void ImageSignaturesAreCheckedPerType()
    {
        Assert.True(ImageValidation.MatchesSignature("image/png", Png));
        Assert.False(ImageValidation.MatchesSignature("image/png", Jpeg));
        Assert.False(ImageValidation.MatchesSignature("image/png", Png.AsSpan(0, 7)));
        Assert.False(ImageValidation.MatchesSignature("image/svg+xml", "<svg"u8));
    }
}
