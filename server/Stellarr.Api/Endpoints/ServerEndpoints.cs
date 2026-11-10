using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Auth;
using Stellarr.Api.Contracts;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;
using Stellarr.Api.Realtime;
using Stellarr.Api.Storage;

namespace Stellarr.Api.Endpoints;

/// <summary>The profile and the icon of the active server.</summary>
public static class ServerEndpoints
{
    private const int MaxNameLength = 80;
    private const int MaxDescriptionLength = 280;
    private const long MaxIconBytes = 4 * 1024 * 1024;

    public static IEndpointRouteBuilder MapServerEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var server = endpoints.MapGroup("/api/admin/server")
            .RequireAuthorization()
            .AddEndpointFilter<ServerMembershipFilter>();
        server.MapPatch("", UpdateAsync);
        server.MapPost("/icon", UploadIconAsync).DisableAntiforgery();
        server.MapDelete("/icon", RemoveIconAsync);
        return endpoints;
    }

    private static async Task<IResult> UpdateAsync(
        UpdateServerRequest request,
        HttpContext http,
        AppDbContext db,
        IHubContext<AppHub> hub,
        CancellationToken cancellationToken)
    {
        if (await FindManagedAsync(http, db, cancellationToken) is not { } server)
        {
            return Results.Forbid();
        }

        var name = request.Name?.Trim();
        if (name is { Length: < 1 or > MaxNameLength })
        {
            return Invalid("name", "Nazwa serwera musi mieć od 1 do 80 znaków.");
        }

        var description = request.Description?.Trim();
        if (description?.Length > MaxDescriptionLength)
        {
            return Invalid("description", "Opis serwera może mieć najwyżej 280 znaków.");
        }

        server.Name = name ?? server.Name;
        server.Description = description ?? server.Description;
        server.IsPublic = request.IsPublic ?? server.IsPublic;
        await db.SaveChangesAsync(cancellationToken);

        var dto = server.ToDto();
        await hub.Clients.Group(AppHub.ServerGroup(server.Id)).SendAsync("ServerUpdated", dto, cancellationToken);
        return Results.Ok(dto);
    }

    private static async Task<IResult> UploadIconAsync(
        [FromForm] IFormFile file,
        HttpContext http,
        AppDbContext db,
        MediaStorage mediaStorage,
        IHubContext<AppHub> hub,
        CancellationToken cancellationToken)
    {
        if (await FindManagedAsync(http, db, cancellationToken) is not { } server)
        {
            return Results.Forbid();
        }

        var inspection = await mediaStorage.InspectImageAsync(file, MaxIconBytes, cancellationToken);
        if (!inspection.Accepted)
        {
            return Refusal(inspection.Failure);
        }

        var id = Guid.NewGuid();
        var key = $"servers/{server.Id:N}/icon/{id:N}{inspection.Spec.Extension}";
        await mediaStorage.StoreAsync(key, file, inspection.Spec.ContentType, cancellationToken);

        db.ImageAttachments.Add(new ImageAttachment
        {
            Id = id,
            UploadedById = http.User.RequireUserId(),
            ObjectKey = key,
            FileName = Path.GetFileName(file.FileName),
            ContentType = inspection.Spec.ContentType,
            SizeBytes = file.Length,
            CreatedAt = DateTime.UtcNow,
        });
        var previousUrl = server.IconUrl;
        var url = $"/assets/{id}";
        server.IconUrl = url;

        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch
        {
            await mediaStorage.RollbackAsync([key]);
            throw;
        }

        await FinishIconChangeAsync(server, previousUrl, mediaStorage, hub, cancellationToken);
        return Results.Created(url, new ServerIconDto(url));
    }

    private static async Task<IResult> RemoveIconAsync(
        HttpContext http,
        AppDbContext db,
        MediaStorage mediaStorage,
        IHubContext<AppHub> hub,
        CancellationToken cancellationToken)
    {
        if (await FindManagedAsync(http, db, cancellationToken) is not { } server)
        {
            return Results.Forbid();
        }

        var previousUrl = server.IconUrl;
        server.IconUrl = null;
        await db.SaveChangesAsync(cancellationToken);

        await FinishIconChangeAsync(server, previousUrl, mediaStorage, hub, cancellationToken);
        return Results.Ok(new ServerIconDto(null));
    }

    /// <summary>The active server, when the caller may manage it.</summary>
    private static async Task<StellarrServer?> FindManagedAsync(
        HttpContext http,
        AppDbContext db,
        CancellationToken cancellationToken)
    {
        var serverId = http.RequireActiveServerId();
        return await ServerAccess.HasAsync(
                db, http.User.RequireUserId(), serverId, ServerPrivileges.ManageServer, cancellationToken)
            ? await db.Servers.SingleOrDefaultAsync(x => x.Id == serverId, cancellationToken)
            : null;
    }

    /// <summary>Retires the picture the server no longer shows and tells its members.</summary>
    private static async Task FinishIconChangeAsync(
        StellarrServer server,
        string? previousUrl,
        MediaStorage mediaStorage,
        IHubContext<AppHub> hub,
        CancellationToken cancellationToken)
    {
        await mediaStorage.QueueAttachmentIfUnreferencedAsync(
            previousUrl, uploadedById: null, DateTime.UtcNow, cancellationToken);
        await hub.Clients.Group(AppHub.ServerGroup(server.Id))
            .SendAsync("ServerUpdated", server.ToDto(), cancellationToken);
    }

    private static IResult Refusal(UploadFailure failure) => failure switch
    {
        UploadFailure.Empty => Invalid("file", "Plik jest pusty."),
        UploadFailure.TooLarge => Results.Problem(
            statusCode: StatusCodes.Status413PayloadTooLarge,
            title: "Ikona jest za duża",
            detail: "Ikona serwera może mieć najwyżej 4 MB."),
        UploadFailure.UnsupportedType => Results.Problem(
            statusCode: StatusCodes.Status415UnsupportedMediaType,
            title: "Nieobsługiwany format ikony",
            detail: "Dozwolone są obrazy JPEG, PNG, GIF i WebP."),
        // A signature that does not fit the declared type.
        _ => Results.Problem(
            statusCode: StatusCodes.Status415UnsupportedMediaType,
            title: "Nieprawidłowy format ikony",
            detail: "Zawartość pliku nie odpowiada zadeklarowanemu typowi."),
    };

    private static IResult Invalid(string field, string message) =>
        Results.ValidationProblem(new Dictionary<string, string[]> { [field] = [message] });
}
