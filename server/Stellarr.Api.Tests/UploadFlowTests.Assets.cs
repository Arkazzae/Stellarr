using System.Net;
using Amazon.Runtime;
using Amazon.S3;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Stellarr.Api.Domain;
using Stellarr.Api.Storage;

namespace Stellarr.Api.Tests;

/// <summary>Reading uploaded attachments back: who may, with which headers, and which bytes.</summary>
public sealed partial class UploadFlowTests
{
    private static readonly Guid SeededMessageId = Guid.Parse("40000000-0000-0000-0000-000000000001");

    [Fact]
    public async Task TheUploaderReadsTheSameBytesBackWithTheHeadersOfAnInlineAsset()
    {
        using var maja = await SignedInAsync(factory, "maja", "Aurora!2026");
        var url = await UploadUrlAsync(maja, Png, "image/png", "tiny.png");

        var response = await maja.GetAsync(url);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(Png, await response.Content.ReadAsByteArrayAsync());
        Assert.Equal("image/png", response.Content.Headers.ContentType?.MediaType);
        Assert.Equal(Png.Length, response.Content.Headers.ContentLength);
        Assert.Equal("bytes", response.Headers.AcceptRanges.Single());
        Assert.Equal("nosniff", response.Headers.GetValues("X-Content-Type-Options").Single());
        Assert.Null(response.Content.Headers.ContentDisposition);
    }

    [Fact]
    public async Task AMemberWhoSharesNoReferenceToTheAttachmentGets404()
    {
        using var maja = await SignedInAsync(factory, "maja", "Aurora!2026");
        using var ada = await SignedInAsync(factory, "ada", "Quasar!2026");
        var url = await UploadUrlAsync(maja, Png, "image/png", "private.png");

        Assert.Equal(HttpStatusCode.NotFound, (await ada.GetAsync(url)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await ada.GetAsync($"{url}/poster")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await maja.GetAsync($"/assets/{Guid.NewGuid()}")).StatusCode);
    }

    [Fact]
    public async Task AnAttachmentIsOpenedToTheMembersOfTheServerOfTheMessageThatCarriesIt()
    {
        using var maja = await SignedInAsync(factory, "maja", "Aurora!2026");
        using var ada = await SignedInAsync(factory, "ada", "Quasar!2026");
        var url = await UploadUrlAsync(maja, Png, "image/png", "shared.png");
        await using (var scope = factory.OpenScope(out var db))
        {
            db.MessageAttachments.Add(new MessageAttachment
            {
                MessageId = SeededMessageId,
                AttachmentId = Guid.Parse(url[(url.LastIndexOf('/') + 1)..]),
            });
            await db.SaveChangesAsync();
        }

        Assert.Equal(Png, await ada.GetByteArrayAsync(url));
    }

    [Fact]
    public async Task AssetsNeedASignedInUser()
    {
        using var maja = await SignedInAsync(factory, "maja", "Aurora!2026");
        var url = await UploadUrlAsync(maja, Png, "image/png", "tiny.png");
        using var anonymous = Client(factory);

        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync(url)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync($"{url}/poster")).StatusCode);
    }

    [Theory]
    [InlineData("bytes=1-2", 1, 2)]
    [InlineData("bytes=3-", 3, 11)]
    [InlineData("bytes=0-0", 0, 0)]
    [InlineData("bytes=2-5,8-9", 2, 5)]
    [InlineData("BYTES=1-2", 1, 2)]
    public async Task ARangeIsAnsweredWith206AndOnlyTheRequestedBytes(string range, int first, int last)
    {
        using var maja = await SignedInAsync(factory, "maja", "Aurora!2026");
        var url = await UploadUrlAsync(maja, Png, "image/png", "tiny.png");

        var response = await maja.SendAsync(Get(url, range));

        Assert.Equal(HttpStatusCode.PartialContent, response.StatusCode);
        Assert.Equal($"bytes {first}-{last}/{Png.Length}", response.Content.Headers.ContentRange?.ToString());
        Assert.Equal(Png[first..(last + 1)], await response.Content.ReadAsByteArrayAsync());
        Assert.Equal(last - first + 1, response.Content.Headers.ContentLength);
        Assert.Equal("bytes", response.Headers.AcceptRanges.Single());
        Assert.Equal("image/png", response.Content.Headers.ContentType?.MediaType);
    }

    [Theory]
    [InlineData("bytes=-5")]
    [InlineData("bytes=5-2")]
    [InlineData("bytes=abc")]
    [InlineData("bytes=")]
    [InlineData("items=0-1")]
    public async Task ARangeThatIsNotServedIsAnsweredWithTheWholeFile(string range)
    {
        using var maja = await SignedInAsync(factory, "maja", "Aurora!2026");
        var url = await UploadUrlAsync(maja, Png, "image/png", "tiny.png");

        var response = await maja.SendAsync(Get(url, range));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(Png, await response.Content.ReadAsByteArrayAsync());
    }

    [Fact]
    public async Task AGenericFileIsOfferedAsADownloadUnderItsVerifiedName()
    {
        using var maja = await SignedInAsync(factory, "maja", "Aurora!2026");
        var url = await UploadUrlAsync(maja, Pdf, "application/pdf", "zażółć gęślą.exe");

        var response = await maja.GetAsync(url);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("attachment", response.Content.Headers.ContentDisposition?.DispositionType);
        Assert.Equal(
            "attachment; filename*=UTF-8''za%C5%BC%C3%B3%C5%82%C4%87%20g%C4%99%C5%9Bl%C4%85.pdf",
            string.Join("", response.Content.Headers.GetValues("Content-Disposition")));
        Assert.Equal("nosniff", response.Headers.GetValues("X-Content-Type-Options").Single());
    }

    [Fact]
    public async Task AVideosPosterIsServedFromItsOwnAddress()
    {
        using var maja = await SignedInAsync(factory, "maja", "Aurora!2026");
        using var form = Form(Mp4, "video/mp4", "clip.mp4");
        form.Add(Image(Jpeg, "image/jpeg"), "poster", "poster.jpg");
        var upload = await ReadAsync(await maja.PostAsync("/api/uploads", form));

        var response = await maja.GetAsync(upload.GetProperty("posterUrl").GetString());

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("image/jpeg", response.Content.Headers.ContentType?.MediaType);
        Assert.Equal(Jpeg.Length, response.Content.Headers.ContentLength);
        Assert.Equal(Jpeg, await response.Content.ReadAsByteArrayAsync());
    }

    [Fact]
    public async Task AnAttachmentWithoutAPosterHasNoPosterAddress()
    {
        using var maja = await SignedInAsync(factory, "maja", "Aurora!2026");
        var url = await UploadUrlAsync(maja, Png, "image/png", "tiny.png");

        Assert.Equal(HttpStatusCode.NotFound, (await maja.GetAsync($"{url}/poster")).StatusCode);
    }

    [Fact]
    public async Task AStorageThatCannotSatisfyARangeAnswers416AndOneThatLostTheObjectAnswers404()
    {
        var storage = new FaultyReadStorage(new FakeObjectStorage());
        using var faulty = new StellarrWebApplicationFactory(
            loadTestData: true,
            configureServices: services =>
            {
                services.RemoveAll<IObjectStorage>();
                services.AddSingleton<IObjectStorage>(storage);
            });
        using var maja = await SignedInAsync(faulty, "maja", "Aurora!2026");
        using var form = Form(Mp4, "video/mp4", "clip.mp4");
        form.Add(Image(Jpeg, "image/jpeg"), "poster", "poster.jpg");
        var upload = await ReadAsync(await maja.PostAsync("/api/uploads", form));
        var url = upload.GetProperty("url").GetString()!;
        var posterUrl = upload.GetProperty("posterUrl").GetString()!;

        storage.Fault = HttpStatusCode.RequestedRangeNotSatisfiable;
        Assert.Equal(HttpStatusCode.RequestedRangeNotSatisfiable, (await maja.SendAsync(Get(url, "bytes=900-"))).StatusCode);

        storage.Fault = HttpStatusCode.NotFound;
        Assert.Equal(HttpStatusCode.NotFound, (await maja.GetAsync(url)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await maja.GetAsync(posterUrl)).StatusCode);
    }

    private static HttpRequestMessage Get(string url, string range)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.TryAddWithoutValidation("Range", range);
        return request;
    }

    private static async Task<string> UploadUrlAsync(HttpClient client, byte[] bytes, string contentType, string fileName)
    {
        var response = await client.PostAsync("/api/uploads", Form(bytes, contentType, fileName));
        response.EnsureSuccessStatusCode();
        return (await ReadAsync(response)).GetProperty("url").GetString()!;
    }

    /// <summary>Reads like an object store that fails on demand with the status it would answer.</summary>
    private sealed class FaultyReadStorage(FakeObjectStorage inner) : IObjectStorage
    {
        public HttpStatusCode? Fault { get; set; }

        public Task EnsureBucketAsync(CancellationToken cancellationToken) => inner.EnsureBucketAsync(cancellationToken);

        public Task PutAsync(string key, Stream data, string contentType, CancellationToken cancellationToken) =>
            inner.PutAsync(key, data, contentType, cancellationToken);

        public Task<StoredObject> GetAsync(string key, ByteRange? range, CancellationToken cancellationToken) =>
            Fault is { } status
                ? throw new AmazonS3Exception("The store refused.", ErrorType.Unknown, "Fault", "request", status)
                : inner.GetAsync(key, range, cancellationToken);

        public Task DeleteAsync(string key, CancellationToken cancellationToken) =>
            inner.DeleteAsync(key, cancellationToken);
    }
}
