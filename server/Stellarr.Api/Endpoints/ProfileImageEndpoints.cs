using System.Security.Claims;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Stellarr.Api.Auth;
using Stellarr.Api.Contracts;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;
using Stellarr.Api.Localization;
using Stellarr.Api.Realtime;
using Stellarr.Api.Storage;

namespace Stellarr.Api.Endpoints;

/// <summary>Sets and removes the avatar and the banner of the signed-in account.</summary>
public static class ProfileImageEndpoints
{
    /// <summary>One of the two pictures a profile has, and the limits that come with it.</summary>
    private sealed record ImageKind(
        string Name,
        long MaxBytes,
        MessageKey TooLargeDetail,
        Func<User, string?> Read,
        Action<User, string?> Write);

    private static readonly ImageKind Avatar = new(
        "avatar",
        4 * 1024 * 1024,
        MessageKey.AvatarMaximum,
        user => user.AvatarUrl,
        (user, url) => user.AvatarUrl = url);

    private static readonly ImageKind Banner = new(
        "banner",
        8 * 1024 * 1024,
        MessageKey.BannerMaximum,
        user => user.BannerUrl,
        (user, url) => user.BannerUrl = url);

    public static IEndpointRouteBuilder MapProfileImageEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var images = endpoints.MapGroup("/api/me/images").RequireAuthorization();
        images.MapPost("/{kind}", UploadAsync).DisableAntiforgery();
        images.MapDelete("/{kind}", RemoveAsync);
        return endpoints;
    }

    private static async Task<IResult> UploadAsync(
        string kind,
        [FromForm] IFormFile file,
        ClaimsPrincipal principal,
        AppDbContext db,
        MediaStorage mediaStorage,
        IHubContext<AppHub> hub,
        PresenceTracker presence,
        Messages messages,
        CancellationToken cancellationToken)
    {
        if (FindKind(kind) is not { } image)
        {
            return Results.NotFound();
        }

        var inspection = await mediaStorage.InspectImageAsync(file, image.MaxBytes, cancellationToken);
        if (!inspection.Accepted)
        {
            return Refusal(inspection, image, messages);
        }

        var user = await AccountEndpoints.FindCurrentAsync(principal, db, cancellationToken);
        var id = Guid.NewGuid();
        var key = $"profiles/{user.Id:N}/{image.Name}/{id:N}{inspection.Spec.Extension}";
        await mediaStorage.StoreAsync(key, file, cancellationToken);

        db.ImageAttachments.Add(new ImageAttachment
        {
            Id = id,
            UploadedById = user.Id,
            ObjectKey = key,
            FileName = Path.GetFileName(file.FileName),
            ContentType = inspection.Spec.ContentType,
            SizeBytes = file.Length,
            CreatedAt = DateTime.UtcNow,
        });
        var previousUrl = image.Read(user);
        var url = $"/assets/{id}";
        image.Write(user, url);

        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch
        {
            await mediaStorage.RollbackAsync([key]);
            throw;
        }

        await mediaStorage.QueueAttachmentIfUnreferencedAsync(previousUrl, user.Id, DateTime.UtcNow, cancellationToken);
        await AccountEndpoints.BroadcastUserUpdatedAsync(hub, presence, user, cancellationToken);
        return Results.Created(url, user.ToAccountDto());
    }

    private static async Task<IResult> RemoveAsync(
        string kind,
        ClaimsPrincipal principal,
        AppDbContext db,
        MediaStorage mediaStorage,
        IHubContext<AppHub> hub,
        PresenceTracker presence,
        CancellationToken cancellationToken)
    {
        if (FindKind(kind) is not { } image)
        {
            return Results.NotFound();
        }

        var user = await AccountEndpoints.FindCurrentAsync(principal, db, cancellationToken);
        var previousUrl = image.Read(user);
        image.Write(user, null);

        await db.SaveChangesAsync(cancellationToken);
        await mediaStorage.QueueAttachmentIfUnreferencedAsync(previousUrl, user.Id, DateTime.UtcNow, cancellationToken);
        await AccountEndpoints.BroadcastUserUpdatedAsync(hub, presence, user, cancellationToken);
        return Results.Ok(user.ToAccountDto());
    }

    private static ImageKind? FindKind(string kind) => kind.Trim().ToLowerInvariant() switch
    {
        "avatar" => Avatar,
        "banner" => Banner,
        _ => null,
    };

    private static IResult Refusal(UploadInspection inspection, ImageKind kind, Messages messages) =>
        inspection.Failure switch
        {
            UploadFailure.Empty => Results.ValidationProblem(
                new Dictionary<string, string[]> { ["file"] = [messages.Get(MessageKey.FileEmpty)] }),
            UploadFailure.TooLarge => Results.Problem(
                statusCode: StatusCodes.Status413PayloadTooLarge,
                title: messages.Get(MessageKey.ProfileImageTooLarge),
                detail: messages.Get(kind.TooLargeDetail)),
            UploadFailure.UnsupportedType => Results.Problem(
                statusCode: StatusCodes.Status415UnsupportedMediaType,
                title: messages.Get(MessageKey.ProfileImageTypeUnsupported),
                detail: messages.Get(MessageKey.ImageTypesAllowed)),
            // A signature that does not fit the declared type.
            _ => Results.Problem(
                statusCode: StatusCodes.Status415UnsupportedMediaType,
                title: messages.Get(MessageKey.ProfileImageTypeMismatch),
                detail: messages.Get(MessageKey.FileContentMismatch)),
        };
}
