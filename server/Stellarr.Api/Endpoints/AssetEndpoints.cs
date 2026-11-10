using System.Globalization;
using System.Net;
using System.Security.Claims;
using Amazon.S3;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Primitives;
using Stellarr.Api.Auth;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;
using Stellarr.Api.Storage;

namespace Stellarr.Api.Endpoints;

/// <summary>Serves attachments out of object storage to the people who may read them.</summary>
public static class AssetEndpoints
{
    private const string BytesPrefix = "bytes=";

    public static IEndpointRouteBuilder MapAssetEndpoints(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/assets/{attachmentId:guid}", GetAssetAsync)
            .RequireAuthorization()
            .WithName("GetAsset");
        endpoints.MapGet("/assets/{attachmentId:guid}/poster", GetPosterAsync)
            .RequireAuthorization()
            .WithName("GetAttachmentPoster");

        return endpoints;
    }

    /// <summary>
    /// Serves an attachment and honours <c>Range</c>.
    /// </summary>
    /// <remarks>
    /// The range is answered here and not by ASP.NET's own range support, which
    /// needs a seekable stream and quietly falls back to a whole-file 200 when
    /// the stream is not one. A browser takes that 200 to mean the media cannot
    /// seek, so every skip in an audio or video attachment would restart it.
    /// </remarks>
    private static async Task<IResult> GetAssetAsync(
        Guid attachmentId,
        ClaimsPrincipal principal,
        HttpContext http,
        AppDbContext db,
        IObjectStorage storage,
        CancellationToken cancellationToken)
    {
        var attachment = await FindReadableAsync(db, principal, attachmentId, cancellationToken);
        if (attachment is null)
        {
            return Results.NotFound();
        }

        try
        {
            var stored = await storage.GetAsync(
                attachment.ObjectKey,
                ParseRange(http.Request.Headers.Range),
                cancellationToken);
            var response = http.Response;

            // Without this a browser does not even try to ask for a range.
            response.Headers.AcceptRanges = "bytes";
            response.ContentType = stored.ContentType;
            response.ContentLength = stored.Length;
            response.Headers.XContentTypeOptions = "nosniff";
            if (IsGenericFile(attachment))
            {
                response.Headers.ContentDisposition =
                    $"attachment; filename*=UTF-8''{Uri.EscapeDataString(attachment.FileName)}";
            }

            if (stored.Range is { } served)
            {
                response.StatusCode = StatusCodes.Status206PartialContent;
                response.Headers.ContentRange = string.Create(
                    CultureInfo.InvariantCulture,
                    $"bytes {served.From}-{served.To ?? stored.TotalLength - 1}/{stored.TotalLength}");
            }

            await using var body = stored.Stream;
            await body.CopyToAsync(response.Body, cancellationToken);
            return Results.Empty;
        }
        catch (AmazonS3Exception exception) when (exception.StatusCode == HttpStatusCode.RequestedRangeNotSatisfiable)
        {
            return Results.StatusCode(StatusCodes.Status416RangeNotSatisfiable);
        }
        catch (AmazonS3Exception exception) when (exception.StatusCode == HttpStatusCode.NotFound)
        {
            return Results.NotFound();
        }
    }

    private static async Task<IResult> GetPosterAsync(
        Guid attachmentId,
        ClaimsPrincipal principal,
        HttpContext http,
        AppDbContext db,
        IObjectStorage storage,
        CancellationToken cancellationToken)
    {
        var attachment = await FindReadableAsync(db, principal, attachmentId, cancellationToken);
        if (attachment?.PosterObjectKey is not { } posterKey)
        {
            return Results.NotFound();
        }

        try
        {
            var stored = await storage.GetAsync(posterKey, null, cancellationToken);
            http.Response.ContentType = attachment.PosterContentType ?? stored.ContentType;
            http.Response.ContentLength = attachment.PosterSizeBytes ?? stored.Length;
            await using var body = stored.Stream;
            await body.CopyToAsync(http.Response.Body, cancellationToken);
            return Results.Empty;
        }
        catch (AmazonS3Exception exception) when (exception.StatusCode == HttpStatusCode.NotFound)
        {
            return Results.NotFound();
        }
    }

    /// <summary>
    /// The attachment, or null when it does not exist or the caller may not read it.
    /// Both look the same from outside, so that an address reveals nothing about
    /// attachments of other people.
    /// </summary>
    private static async Task<ImageAttachment?> FindReadableAsync(
        AppDbContext db,
        ClaimsPrincipal principal,
        Guid attachmentId,
        CancellationToken cancellationToken)
    {
        var attachment = await db.ImageAttachments.AsNoTracking()
            .SingleOrDefaultAsync(x => x.Id == attachmentId, cancellationToken);
        return attachment is not null &&
            await AttachmentAccess.CanReadAsync(db, principal.RequireUserId(), attachmentId, cancellationToken)
                ? attachment
                : null;
    }

    /// <summary>Plain files are offered as downloads. Media is played in the page.</summary>
    private static bool IsGenericFile(ImageAttachment attachment) =>
        AttachmentValidation.TryGetSpec(attachment.ContentType, out var spec) && spec.Kind == UploadKind.File;

    /// <summary>Reads the first range of a <c>Range</c> header, or null for anything it does not serve.</summary>
    /// <remarks>
    /// Only the <c>bytes</c> unit and only the first range are understood: no media
    /// element asks for several, and a form that is not understood may be answered
    /// with the whole file. That includes a suffix such as <c>bytes=-500</c>, which
    /// would need the size of the object before it is read.
    /// </remarks>
    private static ByteRange? ParseRange(StringValues header)
    {
        var value = header.ToString();
        if (!value.StartsWith(BytesPrefix, StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        var first = value.AsSpan(BytesPrefix.Length);
        var comma = first.IndexOf(',');
        if (comma >= 0)
        {
            first = first[..comma];
        }

        var dash = first.IndexOf('-');
        if (dash < 0 ||
            !long.TryParse(first[..dash].Trim(), NumberStyles.None, CultureInfo.InvariantCulture, out var from))
        {
            return null;
        }

        var end = first[(dash + 1)..].Trim();
        if (end.IsEmpty)
        {
            return new ByteRange(from, null);
        }

        return long.TryParse(end, NumberStyles.None, CultureInfo.InvariantCulture, out var to) && to >= from
            ? new ByteRange(from, to)
            : null;
    }
}
