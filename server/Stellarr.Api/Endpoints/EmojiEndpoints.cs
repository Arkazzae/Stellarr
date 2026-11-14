using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Auth;
using Stellarr.Api.Contracts;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;
using Stellarr.Api.Localization;
using Stellarr.Api.Realtime;
using Stellarr.Api.Storage;

namespace Stellarr.Api.Endpoints;

/// <summary>
/// Image emoji that belong to one server. They live in object storage under
/// keys of their own rather than as attachments, so no message can reach them
/// and deleting one never depends on a reference count.
/// </summary>
public static partial class EmojiEndpoints
{
    private const int MaxEmojiPerServer = 100;
    private const long MaxEmojiBytes = 512 * 1024;

    public static IEndpointRouteBuilder MapEmojiEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var emoji = endpoints.MapGroup("/api/emoji")
            .RequireAuthorization()
            .AddEndpointFilter<ServerMembershipFilter>();
        emoji.MapGet("", ListAsync);
        emoji.MapPost("", UploadAsync).DisableAntiforgery();
        emoji.MapDelete("/{emojiId:guid}", DeleteAsync);
        emoji.MapGet("/{emojiId:guid}/image", GetImageAsync);
        return endpoints;
    }

    private static async Task<IResult> ListAsync(
        HttpContext http,
        AppDbContext db,
        CancellationToken cancellationToken)
    {
        var serverId = http.RequireActiveServerId();
        var rows = await db.ServerEmoji.AsNoTracking()
            .Where(x => x.ServerId == serverId)
            .OrderBy(x => x.CreatedAt)
            .ThenBy(x => x.Shortcode)
            .ToListAsync(cancellationToken);
        return Results.Ok(rows.Select(x => x.ToDto()));
    }

    private static async Task<IResult> UploadAsync(
        [FromForm] string shortcode,
        [FromForm] IFormFile file,
        HttpContext http,
        AppDbContext db,
        MediaStorage mediaStorage,
        IHubContext<AppHub> hub,
        Messages messages,
        CancellationToken cancellationToken)
    {
        var serverId = http.RequireActiveServerId();
        var userId = http.User.RequireUserId();
        if (!await ServerAccess.HasAsync(db, userId, serverId, ServerPrivileges.ManageServer, cancellationToken))
        {
            return Results.Forbid();
        }

        var code = shortcode.Trim().Trim(':').ToLowerInvariant();
        if (!ShortcodePattern().IsMatch(code))
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["shortcode"] = [messages.Get(MessageKey.EmojiShortcodeInvalid)],
            });
        }

        var inspection = await mediaStorage.InspectImageAsync(file, MaxEmojiBytes, cancellationToken);
        if (inspection.Failure is not (UploadFailure.None or UploadFailure.SignatureMismatch))
        {
            return Refusal(inspection, messages);
        }

        if (await db.ServerEmoji.AnyAsync(x => x.ServerId == serverId && x.Shortcode == code, cancellationToken))
        {
            return Results.Conflict();
        }

        if (await db.ServerEmoji.CountAsync(x => x.ServerId == serverId, cancellationToken) >= MaxEmojiPerServer)
        {
            return Results.Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: messages.Get(MessageKey.EmojiLimitReached),
                detail: messages.Get(MessageKey.EmojiLimitDetail, ("max", MaxEmojiPerServer)));
        }

        // A file whose bytes do not match its type is reported after the checks
        // on the shortcode and the limit, as it always was.
        if (!inspection.Accepted)
        {
            return Refusal(inspection, messages);
        }

        var id = Guid.NewGuid();
        var key = $"emoji/{DateTimeOffset.UtcNow:yyyy/MM}/{id:N}{inspection.Spec.Extension}";
        var emoji = new ServerEmoji
        {
            Id = id,
            ServerId = serverId,
            Shortcode = code,
            ObjectKey = key,
            ContentType = inspection.Spec.ContentType,
            SizeBytes = file.Length,
            UploadedById = userId,
            CreatedAt = DateTime.UtcNow,
        };

        var saved = false;
        try
        {
            await mediaStorage.StoreAsync(key, file, cancellationToken);
            db.ServerEmoji.Add(emoji);
            // Another upload may have taken the shortcode since the check above.
            saved = await db.TrySaveChangesAsync(cancellationToken);
        }
        finally
        {
            if (!saved)
            {
                await mediaStorage.RollbackAsync([key]);
            }
        }

        if (!saved)
        {
            return Results.Conflict();
        }

        await NotifyChangedAsync(hub, serverId, cancellationToken);
        return Results.Created($"/api/emoji/{id}", emoji.ToDto());
    }

    private static async Task<IResult> DeleteAsync(
        Guid emojiId,
        HttpContext http,
        AppDbContext db,
        MediaStorage mediaStorage,
        IHubContext<AppHub> hub,
        CancellationToken cancellationToken)
    {
        var serverId = http.RequireActiveServerId();
        if (!await ServerAccess.HasAsync(
                db, http.User.RequireUserId(), serverId, ServerPrivileges.ManageServer, cancellationToken))
        {
            return Results.Forbid();
        }

        var emoji = await db.ServerEmoji.FirstOrDefaultAsync(
            x => x.Id == emojiId && x.ServerId == serverId, cancellationToken);
        if (emoji is null)
        {
            return Results.NotFound();
        }

        await mediaStorage.QueueDeletionAsync([emoji.ObjectKey], DateTime.UtcNow, cancellationToken);
        db.ServerEmoji.Remove(emoji);
        await db.SaveChangesAsync(cancellationToken);
        await NotifyChangedAsync(hub, serverId, cancellationToken);
        return Results.NoContent();
    }

    private static async Task<IResult> GetImageAsync(
        Guid emojiId,
        HttpContext http,
        AppDbContext db,
        IObjectStorage storage,
        CancellationToken cancellationToken)
    {
        var serverId = http.RequireActiveServerId();
        var emoji = await db.ServerEmoji.AsNoTracking()
            .FirstOrDefaultAsync(x => x.Id == emojiId && x.ServerId == serverId, cancellationToken);
        if (emoji is null)
        {
            return Results.NotFound();
        }

        try
        {
            var stored = await storage.GetAsync(emoji.ObjectKey, null, cancellationToken);
            http.Response.ContentType = emoji.ContentType;
            http.Response.ContentLength = emoji.SizeBytes;
            // The address changes with the emoji, so the browser may keep it.
            http.Response.Headers.CacheControl = "private, max-age=86400, immutable";
            await using var body = stored.Stream;
            await body.CopyToAsync(http.Response.Body, cancellationToken);
            return Results.Empty;
        }
        catch (ObjectNotFoundException)
        {
            return Results.NotFound();
        }
    }

    private static Task NotifyChangedAsync(IHubContext<AppHub> hub, Guid serverId, CancellationToken cancellationToken) =>
        hub.Clients.Group(AppHub.ServerGroup(serverId)).SendAsync("EmojiChanged", new { }, cancellationToken);

    private static IResult Refusal(UploadInspection inspection, Messages messages) => inspection.Failure switch
    {
        // An empty file is reported like an oversized one, as it always was.
        UploadFailure.Empty or UploadFailure.TooLarge => Results.Problem(
            statusCode: StatusCodes.Status413PayloadTooLarge,
            title: messages.Get(MessageKey.EmojiTooLarge),
            detail: messages.Get(MessageKey.EmojiMaximum)),
        UploadFailure.UnsupportedType => Results.Problem(
            statusCode: StatusCodes.Status415UnsupportedMediaType,
            title: messages.Get(MessageKey.EmojiTypeUnsupported),
            detail: messages.Get(MessageKey.ImageTypesAllowed)),
        _ => Results.Problem(
            statusCode: StatusCodes.Status415UnsupportedMediaType,
            title: messages.Get(MessageKey.EmojiTypeMismatch),
            detail: messages.Get(MessageKey.FileContentMismatch)),
    };

    [GeneratedRegex("^[a-z0-9_]{2,32}$", RegexOptions.CultureInvariant)]
    private static partial Regex ShortcodePattern();
}
