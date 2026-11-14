using System.Net;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Stellarr.Api.Storage;

namespace Stellarr.Api.Tests;

/// <summary>Attachments served from real files on the data volume, as an instance keeps them.</summary>
public sealed partial class UploadFlowTests
{
    [Fact]
    public async Task AnAttachmentKeptAsAFileIsServedWholeInRangesAndNotPastItsEnd()
    {
        var dataRoot = Path.Combine(Path.GetTempPath(), $"stellarr-data-{Guid.NewGuid():N}");
        var root = Path.Combine(dataRoot, FileSystemObjectStorage.FolderName);
        using var files = new StellarrWebApplicationFactory(
            loadTestData: true,
            dataRoot: dataRoot,
            configureServices: services =>
            {
                services.RemoveAll<IObjectStorage>();
                services.AddSingleton<IObjectStorage>(new FileSystemObjectStorage(root));
            });
        using var maja = await SignedInAsync(files, "maja", "Aurora!2026");
        using var form = Form(Mp4, "video/mp4", "clip.mp4");
        form.Add(Image(Jpeg, "image/jpeg"), "poster", "poster.jpg");
        var upload = await ReadAsync(await maja.PostAsync("/api/uploads", form));
        var url = upload.GetProperty("url").GetString()!;

        var whole = await maja.GetAsync(url);
        Assert.Equal(HttpStatusCode.OK, whole.StatusCode);
        Assert.Equal(Mp4, await whole.Content.ReadAsByteArrayAsync());
        Assert.Equal("video/mp4", whole.Content.Headers.ContentType?.MediaType);
        Assert.Equal(Mp4.Length, whole.Content.Headers.ContentLength);

        var part = await maja.SendAsync(Get(url, "bytes=2-5"));
        Assert.Equal(HttpStatusCode.PartialContent, part.StatusCode);
        Assert.Equal($"bytes 2-5/{Mp4.Length}", part.Content.Headers.ContentRange?.ToString());
        Assert.Equal(Mp4[2..6], await part.Content.ReadAsByteArrayAsync());
        Assert.Equal(4, part.Content.Headers.ContentLength);

        var tail = await maja.SendAsync(Get(url, $"bytes={Mp4.Length - 3}-"));
        Assert.Equal(HttpStatusCode.PartialContent, tail.StatusCode);
        Assert.Equal(Mp4[^3..], await tail.Content.ReadAsByteArrayAsync());

        Assert.Equal(
            HttpStatusCode.RequestedRangeNotSatisfiable,
            (await maja.SendAsync(Get(url, $"bytes={Mp4.Length}-"))).StatusCode);

        var poster = await maja.GetAsync(upload.GetProperty("posterUrl").GetString());
        Assert.Equal(HttpStatusCode.OK, poster.StatusCode);
        Assert.Equal("image/jpeg", poster.Content.Headers.ContentType?.MediaType);
        Assert.Equal(Jpeg, await poster.Content.ReadAsByteArrayAsync());

        // A file removed from the disk by hand is a missing attachment, not an error.
        var attachmentId = Guid.Parse(url[(url.LastIndexOf('/') + 1)..]);
        await using (var scope = files.OpenScope(out var db))
        {
            var key = await db.ImageAttachments.Where(x => x.Id == attachmentId).Select(x => x.ObjectKey).SingleAsync();
            File.Delete(Path.Combine(root, key));
        }

        Assert.Equal(HttpStatusCode.NotFound, (await maja.GetAsync(url)).StatusCode);
    }
}
