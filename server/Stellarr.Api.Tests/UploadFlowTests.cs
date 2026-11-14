using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Stellarr.Api.Data;
using Stellarr.Api.Storage;

namespace Stellarr.Api.Tests;

public sealed partial class UploadFlowTests(StellarrWebApplicationFactory factory)
    : IClassFixture<StellarrWebApplicationFactory>
{
    private static readonly Guid MajaId = Guid.Parse("30000000-0000-0000-0000-000000000001");
    private static readonly byte[] Png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3, 4];
    private static readonly byte[] Jpeg = [0xFF, 0xD8, 0xFF, 0xE0, 0, 0, 0, 0];
    private static readonly byte[] Wave = "RIFF\0\0\0\0WAVE\0\0\0\0"u8.ToArray();
    private static readonly byte[] Mp4 = [0, 0, 0, 16, (byte)'f', (byte)'t', (byte)'y', (byte)'p', 1, 2, 3, 4];
    private static readonly byte[] Pdf = "%PDF-1.7\n%%EOF\n"u8.ToArray();

    [GeneratedRegex(@"^images/\d{4}/\d{2}/(?<id>[0-9a-f]{32})\.png$")]
    private static partial Regex ImageKey();

    [Fact]
    public async Task APngIsAnsweredWithItsAssetAddressAndStoredAsAnImage()
    {
        using var client = await SignedInAsync(factory, "maja", "Aurora!2026");

        var response = await client.PostAsync("/api/uploads", Form(Png, "image/png", "tiny.png"));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var attachment = await ReadAsync(response);
        var id = attachment.GetProperty("id").GetString()!;
        Assert.Equal($"/assets/{id}", response.Headers.Location?.OriginalString);
        Assert.Equal($"/assets/{id}", attachment.GetProperty("url").GetString());
        Assert.Equal("tiny.png", attachment.GetProperty("name").GetString());
        Assert.Equal("image/png", attachment.GetProperty("contentType").GetString());
        Assert.Equal(Png.Length, attachment.GetProperty("size").GetInt64());
        Assert.False(attachment.GetProperty("isVoiceMessage").GetBoolean());
        Assert.Equal(JsonValueKind.Null, attachment.GetProperty("posterUrl").ValueKind);

        await using var scope = factory.OpenScope(out var db);
        var row = await db.ImageAttachments.SingleAsync(x => x.Id == Guid.Parse(id));
        Assert.Equal(MajaId, row.UploadedById);
        var match = ImageKey().Match(row.ObjectKey);
        Assert.True(match.Success, row.ObjectKey);
        Assert.Equal(Guid.Parse(id).ToString("N"), match.Groups["id"].Value);
        Assert.True(Storage(scope).Contains(row.ObjectKey));
    }

    [Fact]
    public async Task TheOlderImageAddressStillAcceptsUploads()
    {
        using var client = await SignedInAsync(factory, "maja", "Aurora!2026");

        var response = await client.PostAsync("/api/uploads/images", Form(Png, "image/png", "legacy.png"));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    [Fact]
    public async Task UploadsNeedASignedInUser()
    {
        using var anonymous = Client(factory);

        var response = await anonymous.PostAsync("/api/uploads", Form(Png, "image/png", "tiny.png"));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Theory]
    [InlineData("audio/wav", "audio/", ".wav")]
    [InlineData("video/mp4", "videos/", ".mp4")]
    [InlineData("application/pdf", "files/", ".pdf")]
    public async Task EachKindIsStoredUnderItsOwnFolder(string contentType, string folder, string extension)
    {
        using var client = await SignedInAsync(factory, "maja", "Aurora!2026");
        byte[] body = contentType switch
        {
            "audio/wav" => Wave,
            "video/mp4" => Mp4,
            _ => Pdf,
        };

        var response = await client.PostAsync("/api/uploads", Form(body, contentType, "sample"));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var id = Guid.Parse((await ReadAsync(response)).GetProperty("id").GetString()!);
        await using var scope = factory.OpenScope(out var db);
        var key = (await db.ImageAttachments.SingleAsync(x => x.Id == id)).ObjectKey;
        Assert.StartsWith(folder, key, StringComparison.Ordinal);
        Assert.EndsWith(extension, key, StringComparison.Ordinal);
    }

    [Fact]
    public async Task TheDownloadNameKeepsTheStemButTakesItsExtensionFromTheVerifiedType()
    {
        using var client = await SignedInAsync(factory, "maja", "Aurora!2026");

        var response = await client.PostAsync("/api/uploads", Form(Pdf, "application/pdf", "release notes.exe"));

        Assert.Equal("release notes.pdf", (await ReadAsync(response)).GetProperty("name").GetString());
    }

    [Theory]
    [InlineData("my:file*name?.png", "myfilename.png")]
    [InlineData("../../etc/passwd.png", "passwd.png")]
    [InlineData("////", "attachment.png")]
    [InlineData("   ...   .png", "attachment.png")]
    public async Task TheDownloadNameDropsEverythingThatIsNotAWordOrASeparator(string submitted, string expected)
    {
        using var client = await SignedInAsync(factory, "maja", "Aurora!2026");

        var response = await client.PostAsync("/api/uploads", Form(Png, "image/png", submitted));

        Assert.Equal(expected, (await ReadAsync(response)).GetProperty("name").GetString());
    }

    [Theory]
    [InlineData("text/html")]
    [InlineData("image/svg+xml")]
    [InlineData("application/x-msdownload")]
    public async Task AnUnsupportedTypeAnswers415AndStoresNothing(string contentType)
    {
        using var client = await SignedInAsync(factory, "maja", "Aurora!2026");
        await using var scope = factory.OpenScope(out _);
        var before = Storage(scope).Count;

        var response = await client.PostAsync("/api/uploads", Form("<html>"u8.ToArray(), contentType, "page"));

        Assert.Equal(HttpStatusCode.UnsupportedMediaType, response.StatusCode);
        Assert.Equal("Nieobsługiwany format załącznika", (await ReadAsync(response)).GetProperty("title").GetString());
        Assert.Equal(before, Storage(scope).Count);
    }

    [Fact]
    public async Task ABodyThatDoesNotMatchItsDeclaredTypeAnswers415AndStoresNothing()
    {
        using var client = await SignedInAsync(factory, "maja", "Aurora!2026");
        await using var scope = factory.OpenScope(out _);
        var before = Storage(scope).Count;

        var response = await client.PostAsync(
            "/api/uploads", Form("not really an mp3"u8.ToArray(), "audio/mpeg", "fake.mp3"));

        Assert.Equal(HttpStatusCode.UnsupportedMediaType, response.StatusCode);
        Assert.Equal("Nieprawidłowy format załącznika", (await ReadAsync(response)).GetProperty("title").GetString());
        Assert.Equal(before, Storage(scope).Count);
    }

    [Fact]
    public async Task AnEmptyFileAnswers400()
    {
        using var client = await SignedInAsync(factory, "maja", "Aurora!2026");

        var response = await client.PostAsync("/api/uploads", Form([], "image/png", "empty.png"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.True((await ReadAsync(response)).GetProperty("errors").TryGetProperty("file", out _));
    }

    [Fact]
    public async Task AFileOverItsKindsLimitAnswers413ButOneAtTheLimitIsAccepted()
    {
        using var limited = new StellarrWebApplicationFactory(
            loadTestData: true,
            new Dictionary<string, string?> { ["Uploads:MaxImageBytes"] = "12" });
        using var client = await SignedInAsync(limited, "maja", "Aurora!2026");

        var atLimit = await client.PostAsync("/api/uploads", Form(Png, "image/png", "fits.png"));
        var over = await client.PostAsync("/api/uploads", Form([.. Png, 0], "image/png", "large.png"));
        var otherKind = await client.PostAsync("/api/uploads", Form(Pdf, "application/pdf", "other.pdf"));

        Assert.Equal(HttpStatusCode.Created, atLimit.StatusCode);
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, over.StatusCode);
        Assert.Equal("Załącznik jest za duży", (await ReadAsync(over)).GetProperty("title").GetString());
        Assert.Equal(HttpStatusCode.Created, otherKind.StatusCode);
    }

    [Fact]
    public async Task AVideoMayCarryAPosterThatIsServedFromItsOwnAddress()
    {
        using var client = await SignedInAsync(factory, "maja", "Aurora!2026");
        using var form = Form(Mp4, "video/mp4", "clip.mp4", ("durationSeconds", "42.1254"), ("width", "1920"), ("height", "1080"));
        form.Add(Image(Jpeg, "image/jpeg"), "poster", "poster.jpg");

        var response = await client.PostAsync("/api/uploads", form);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var attachment = await ReadAsync(response);
        var id = attachment.GetProperty("id").GetString();
        Assert.Equal($"/assets/{id}/poster", attachment.GetProperty("posterUrl").GetString());
        Assert.Equal(42.125, attachment.GetProperty("durationSeconds").GetDouble());
        Assert.Equal(1920, attachment.GetProperty("width").GetInt32());
        Assert.Equal(1080, attachment.GetProperty("height").GetInt32());

        await using var scope = factory.OpenScope(out var db);
        var row = await db.ImageAttachments.SingleAsync(x => x.Id == Guid.Parse(id!));
        Assert.StartsWith("posters/", row.PosterObjectKey, StringComparison.Ordinal);
        Assert.EndsWith(".jpg", row.PosterObjectKey, StringComparison.Ordinal);
        Assert.Equal("image/jpeg", row.PosterContentType);
        Assert.Equal(Jpeg.Length, row.PosterSizeBytes);
        Assert.True(Storage(scope).Contains(row.PosterObjectKey!));
    }

    [Fact]
    public async Task APosterIsRefusedForEveryKindButVideo()
    {
        using var client = await SignedInAsync(factory, "maja", "Aurora!2026");
        using var form = Form(Png, "image/png", "photo.png");
        form.Add(Image(Jpeg, "image/jpeg"), "poster", "poster.jpg");

        var response = await client.PostAsync("/api/uploads", form);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.True((await ReadAsync(response)).GetProperty("errors").TryGetProperty("poster", out _));
    }

    [Theory]
    [InlineData("audio")]
    [InlineData("mismatch")]
    [InlineData("empty")]
    [InlineData("tooLarge")]
    public async Task APosterThatIsNotAGoodSmallImageIsRefused(string defect)
    {
        using var client = await SignedInAsync(factory, "maja", "Aurora!2026");
        await using var scope = factory.OpenScope(out _);
        var before = Storage(scope).Count;
        using var form = Form(Mp4, "video/mp4", "clip.mp4");
        form.Add(
            defect switch
            {
                "audio" => Image(Wave, "audio/wav"),
                "mismatch" => Image(Png, "image/jpeg"),
                "empty" => Image([], "image/jpeg"),
                _ => Image([.. Jpeg, .. new byte[2 * 1024 * 1024]], "image/jpeg"),
            },
            "poster",
            "poster.jpg");

        var response = await client.PostAsync("/api/uploads", form);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.True((await ReadAsync(response)).GetProperty("errors").TryGetProperty("poster", out _));
        Assert.Equal(before, Storage(scope).Count);
    }

    [Fact]
    public async Task ARecordedVoiceMessageIsAudioWithAMeasuredDuration()
    {
        using var client = await SignedInAsync(factory, "maja", "Aurora!2026");

        var accepted = await client.PostAsync(
            "/api/uploads",
            Form(Wave, "audio/wav", "voice.wav", ("durationSeconds", "4.125"), ("voiceMessage", "true")));

        Assert.Equal(HttpStatusCode.Created, accepted.StatusCode);
        var attachment = await ReadAsync(accepted);
        Assert.True(attachment.GetProperty("isVoiceMessage").GetBoolean());
        Assert.Equal(4.125, attachment.GetProperty("durationSeconds").GetDouble());

        var plain = await client.PostAsync(
            "/api/uploads",
            Form(Wave, "audio/wav", "song.wav", ("durationSeconds", "4.125")));
        Assert.False((await ReadAsync(plain)).GetProperty("isVoiceMessage").GetBoolean());
    }

    [Theory]
    [InlineData("image", null)]
    [InlineData("audio", null)]
    [InlineData("audio", "0")]
    [InlineData("audio", "-3")]
    [InlineData("audio", "600.001")]
    [InlineData("audio", "NaN")]
    [InlineData("audio", "Infinity")]
    public async Task AVoiceMessageNeedsAudioAndADurationUpToTenMinutes(string kind, string? duration)
    {
        using var client = await SignedInAsync(factory, "maja", "Aurora!2026");
        var form = kind == "image"
            ? Form(Png, "image/png", "voice.png", ("durationSeconds", "2"), ("voiceMessage", "true"))
            : Form(Wave, "audio/wav", "voice.wav", [.. DurationField(duration), ("voiceMessage", "true")]);

        var response = await client.PostAsync("/api/uploads", form);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.True((await ReadAsync(response)).GetProperty("errors").TryGetProperty("voiceMessage", out _));
    }

    [Theory]
    [InlineData("image/png", "durationSeconds", "2")]
    [InlineData("application/pdf", "durationSeconds", "2")]
    [InlineData("audio/wav", "durationSeconds", "0")]
    [InlineData("audio/wav", "durationSeconds", "-1")]
    [InlineData("video/mp4", "durationSeconds", "NaN")]
    [InlineData("video/mp4", "durationSeconds", "2592000.5")]
    public async Task ADurationIsRefusedForKindsWithoutOneAndWhenItIsNotAPositiveLength(
        string contentType, string field, string value)
    {
        using var client = await SignedInAsync(factory, "maja", "Aurora!2026");

        var response = await client.PostAsync("/api/uploads", Form(BodyFor(contentType), contentType, "file", (field, value)));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.True((await ReadAsync(response)).GetProperty("errors").TryGetProperty("durationSeconds", out _));
    }

    [Theory]
    [InlineData("audio/wav", "10", "10")]
    [InlineData("application/pdf", "10", "10")]
    [InlineData("image/png", "10", null)]
    [InlineData("image/png", null, "10")]
    [InlineData("image/png", "0", "10")]
    [InlineData("image/png", "10", "-5")]
    [InlineData("video/mp4", "32769", "10")]
    [InlineData("video/mp4", "10", "32769")]
    public async Task DimensionsComeInPairsWithinBoundsAndOnlyForImagesAndVideo(
        string contentType, string? width, string? height)
    {
        using var client = await SignedInAsync(factory, "maja", "Aurora!2026");
        var fields = new List<(string, string)>();
        if (width is not null) fields.Add(("width", width));
        if (height is not null) fields.Add(("height", height));

        var response = await client.PostAsync(
            "/api/uploads", Form(BodyFor(contentType), contentType, "file", [.. fields]));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.True((await ReadAsync(response)).GetProperty("errors").TryGetProperty("dimensions", out _));
    }

    [Fact]
    public async Task DimensionsAtTheBoundAreAccepted()
    {
        using var client = await SignedInAsync(factory, "maja", "Aurora!2026");

        var response = await client.PostAsync(
            "/api/uploads", Form(Png, "image/png", "wide.png", ("width", "32768"), ("height", "1")));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    [Fact]
    public async Task AnAccountOverItsQuotaIsRefusedWith507BeforeAnythingReachesStorage()
    {
        using var limited = new StellarrWebApplicationFactory(
            loadTestData: true,
            new Dictionary<string, string?>
            {
                ["Uploads:MaxStoredBytesPerUser"] = "1",
                ["Uploads:MinimumFreeDataRootBytes"] = "0",
            });
        using var client = await SignedInAsync(limited, "maja", "Aurora!2026");

        var response = await client.PostAsync("/api/uploads", Form(Png, "image/png", "tiny.png"));

        Assert.Equal((HttpStatusCode)507, response.StatusCode);
        Assert.Equal("Brak miejsca na załącznik", (await ReadAsync(response)).GetProperty("title").GetString());
        await using var scope = limited.OpenScope(out var db);
        Assert.Equal(0, Storage(scope).Count);
        Assert.False(await db.ImageAttachments.AnyAsync());
    }

    [Fact]
    public async Task AFailedPosterWriteTakesTheVideoOutOfStorageAgain()
    {
        var inner = new FakeObjectStorage();
        using var faulty = new StellarrWebApplicationFactory(
            loadTestData: true,
            configureServices: services =>
            {
                services.RemoveAll<IObjectStorage>();
                services.AddSingleton<IObjectStorage>(new PosterRejectingStorage(inner));
            });
        using var client = await SignedInAsync(faulty, "maja", "Aurora!2026");
        using var form = Form(Mp4, "video/mp4", "clip.mp4");
        form.Add(Image(Jpeg, "image/jpeg"), "poster", "poster.jpg");

        var response = await client.PostAsync("/api/uploads", form);

        Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
        Assert.Equal(0, inner.Count);
        await using var scope = faulty.OpenScope(out var db);
        Assert.False(await db.ImageAttachments.AnyAsync());
        Assert.False(await db.ObjectDeletions.AnyAsync());
    }

    private static byte[] BodyFor(string contentType) => contentType switch
    {
        "image/png" => Png,
        "audio/wav" => Wave,
        "video/mp4" => Mp4,
        _ => Pdf,
    };

    private static (string, string)[] DurationField(string? duration) =>
        duration is null ? [] : [("durationSeconds", duration)];

    private static FakeObjectStorage Storage(AsyncServiceScope scope) =>
        (FakeObjectStorage)scope.ServiceProvider.GetRequiredService<IObjectStorage>();

    private static ByteArrayContent Image(byte[] bytes, string contentType)
    {
        var content = new ByteArrayContent(bytes);
        content.Headers.ContentType = new MediaTypeHeaderValue(contentType);
        return content;
    }

    private static MultipartFormDataContent Form(
        byte[] bytes, string contentType, string fileName, params (string Name, string Value)[] fields)
    {
        var form = new MultipartFormDataContent { { Image(bytes, contentType), "file", fileName } };
        foreach (var (name, value) in fields)
        {
            form.Add(new StringContent(value), name);
        }

        return form;
    }

    private static HttpClient Client(StellarrWebApplicationFactory target) =>
        target.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false, HandleCookies = true });

    private static async Task<HttpClient> SignedInAsync(
        StellarrWebApplicationFactory target, string username, string password)
    {
        var client = Client(target);
        (await client.PostAsJsonAsync("/api/auth/login", new { username, password })).EnsureSuccessStatusCode();
        return client;
    }

    private static async Task<JsonElement> ReadAsync(HttpResponseMessage response)
    {
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return document.RootElement.Clone();
    }

    /// <summary>Stores everything except posters, which it refuses as an unreachable store would.</summary>
    private sealed class PosterRejectingStorage(FakeObjectStorage inner) : IObjectStorage
    {
        public Task PrepareAsync(CancellationToken cancellationToken) => inner.PrepareAsync(cancellationToken);

        public Task PutAsync(string key, Stream data, CancellationToken cancellationToken) =>
            key.StartsWith("posters/", StringComparison.Ordinal)
                ? throw new IOException("The object store went away.")
                : inner.PutAsync(key, data, cancellationToken);

        public Task<StoredObject> GetAsync(string key, ByteRange? range, CancellationToken cancellationToken) =>
            inner.GetAsync(key, range, cancellationToken);

        public Task DeleteAsync(string key, CancellationToken cancellationToken) =>
            inner.DeleteAsync(key, cancellationToken);

        public IAsyncEnumerable<StoredObjectInfo> ListAsync(CancellationToken cancellationToken) =>
            inner.ListAsync(cancellationToken);

        public Task ProbeAsync(CancellationToken cancellationToken) => inner.ProbeAsync(cancellationToken);
    }
}
