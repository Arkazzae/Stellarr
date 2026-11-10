using System.Globalization;
using System.Security.Claims;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Stellarr.Api.Auth;
using Stellarr.Api.Contracts;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;
using Stellarr.Api.Storage;

namespace Stellarr.Api.Endpoints;

/// <summary>Accepts files that members attach to messages.</summary>
public static class UploadEndpoints
{
    private const long MaximumPosterBytes = 2 * 1024 * 1024;
    private const double MaximumMediaDurationSeconds = 30 * 24 * 60 * 60;
    private const int MaximumMediaDimension = 32_768;
    private const int MaximumFileNameStemLength = 200;

    public static IEndpointRouteBuilder MapUploadEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var api = endpoints.MapGroup("/api")
            .RequireAuthorization()
            .AddEndpointFilter<ServerMembershipFilter>();
        api.MapPost("/uploads", UploadAsync)
            .DisableAntiforgery()
            .RequireRateLimiting(RateLimitPolicies.Uploads);
        // Clients deployed before uploads accepted more than images still use this address.
        api.MapPost("/uploads/images", UploadAsync)
            .DisableAntiforgery()
            .RequireRateLimiting(RateLimitPolicies.Uploads);

        return endpoints;
    }

    private static async Task<IResult> UploadAsync(
        [FromForm] IFormFile file,
        [FromForm] double? durationSeconds,
        [FromForm] int? width,
        [FromForm] int? height,
        [FromForm] IFormFile? poster,
        [FromForm] bool? voiceMessage,
        ClaimsPrincipal principal,
        AppDbContext db,
        MediaStorage mediaStorage,
        UploadAdmissionGate admissionGate,
        IOptions<UploadOptions> uploadOptions,
        CancellationToken cancellationToken)
    {
        var inspection = await mediaStorage.InspectAttachmentAsync(file, uploadOptions.Value, cancellationToken);
        if (!inspection.Accepted)
        {
            return Refusal(inspection);
        }

        var spec = inspection.Spec;
        var isVoiceMessage = voiceMessage == true;
        if (MetadataProblem(spec, isVoiceMessage, durationSeconds, width, height) is { } problem)
        {
            return problem;
        }

        var id = Guid.NewGuid();
        var month = DateTimeOffset.UtcNow.ToString("yyyy/MM", CultureInfo.InvariantCulture);
        PosterUpload? posterUpload = null;
        if (poster is not null)
        {
            var posterInspection = await mediaStorage.InspectImageAsync(poster, MaximumPosterBytes, cancellationToken);
            if (spec.Kind != UploadKind.Video || !posterInspection.Accepted)
            {
                return Invalid("poster", "Podgląd wideo jest nieprawidłowy.");
            }

            posterUpload = new PosterUpload(
                poster,
                posterInspection.Spec,
                $"posters/{month}/{id:N}{posterInspection.Spec.Extension}");
        }

        var userId = principal.RequireUserId();
        var admission = await admissionGate.TryEnterAsync(
            db,
            userId,
            file.Length + (posterUpload?.File.Length ?? 0),
            cancellationToken);
        if (!admission.Accepted)
        {
            return NoRoom(admission.Failure);
        }

        await using var lease = admission.Lease;

        var key = $"{spec.Folder}/{month}/{id:N}{spec.Extension}";
        var attachment = new ImageAttachment
        {
            Id = id,
            UploadedById = userId,
            ObjectKey = key,
            FileName = SafeFileName(file.FileName, spec),
            ContentType = spec.ContentType,
            SizeBytes = file.Length,
            Width = width,
            Height = height,
            DurationSeconds = durationSeconds is { } measured ? Math.Round(measured, 3) : null,
            IsVoiceMessage = isVoiceMessage,
            PosterObjectKey = posterUpload?.Key,
            PosterContentType = posterUpload?.Spec.ContentType,
            PosterSizeBytes = posterUpload?.File.Length,
            CreatedAt = DateTime.UtcNow,
        };

        try
        {
            await mediaStorage.StoreAsync(key, file, spec.ContentType, cancellationToken);
            if (posterUpload is not null)
            {
                await mediaStorage.StoreAsync(
                    posterUpload.Key,
                    posterUpload.File,
                    posterUpload.Spec.ContentType,
                    cancellationToken);
            }

            db.ImageAttachments.Add(attachment);
            await db.SaveChangesAsync(cancellationToken);
        }
        catch
        {
            await mediaStorage.RollbackAsync([key, posterUpload?.Key]);
            throw;
        }

        return Results.Created($"/assets/{id}", attachment.ToDto());
    }

    /// <summary>The still image that stands in for a video before it plays.</summary>
    private sealed record PosterUpload(IFormFile File, UploadSpec Spec, string Key);

    private static IResult Refusal(UploadInspection inspection) => inspection.Failure switch
    {
        UploadFailure.Empty => Invalid("file", "Plik jest pusty."),
        UploadFailure.UnsupportedType => Results.Problem(
            statusCode: StatusCodes.Status415UnsupportedMediaType,
            title: "Nieobsługiwany format załącznika",
            detail: "Dozwolone są obsługiwane obrazy, audio i wideo oraz pliki PDF, ZIP, TXT, JSON, DOCX, XLSX i PPTX."),
        UploadFailure.TooLarge => Results.Problem(
            statusCode: StatusCodes.Status413PayloadTooLarge,
            title: "Załącznik jest za duży",
            detail: inspection.Spec?.Kind switch
            {
                UploadKind.Image => "Maksymalny rozmiar obrazu to 10 MB.",
                UploadKind.Audio => "Maksymalny rozmiar audio to 25 MB.",
                UploadKind.Video => "Maksymalny rozmiar wideo to 100 MB.",
                UploadKind.File => "Maksymalny rozmiar pliku to 25 MB.",
                _ => "Załącznik przekracza limit.",
            }),
        // A signature that does not fit the declared type.
        _ => Results.Problem(
            statusCode: StatusCodes.Status415UnsupportedMediaType,
            title: "Nieprawidłowy format załącznika",
            detail: "Zawartość pliku nie odpowiada zadeklarowanemu typowi."),
    };

    /// <summary>
    /// Checks the properties the client measured: duration, dimensions and
    /// whether the file is a recorded voice message. Null when all of them fit the file.
    /// </summary>
    private static IResult? MetadataProblem(
        UploadSpec spec,
        bool isVoiceMessage,
        double? durationSeconds,
        int? width,
        int? height)
    {
        if (isVoiceMessage &&
            (spec.Kind != UploadKind.Audio ||
             durationSeconds is not { } voiceDuration ||
             !double.IsFinite(voiceDuration) ||
             voiceDuration <= 0 ||
             voiceDuration > MessageLimits.MaxVoiceMessageDurationSeconds))
        {
            return Invalid(
                "voiceMessage",
                $"Wiadomość głosowa musi być nagraniem audio o długości do {MessageLimits.MaxVoiceMessageDurationSeconds / 60:0} minut.");
        }

        if (durationSeconds is { } duration &&
            (spec.Kind is UploadKind.Image or UploadKind.File ||
             !double.IsFinite(duration) ||
             duration <= 0 ||
             duration > MaximumMediaDurationSeconds))
        {
            return Invalid("durationSeconds", "Czas trwania pliku jest nieprawidłowy.");
        }

        if (width.HasValue != height.HasValue ||
            width is <= 0 or > MaximumMediaDimension ||
            height is <= 0 or > MaximumMediaDimension ||
            (width.HasValue && spec.Kind is UploadKind.Audio or UploadKind.File))
        {
            return Invalid("dimensions", "Wymiary pliku są nieprawidłowe.");
        }

        return null;
    }

    private static IResult NoRoom(UploadAdmissionFailure failure) => Results.Problem(
        statusCode: StatusCodes.Status507InsufficientStorage,
        title: "Brak miejsca na załącznik",
        detail: failure switch
        {
            UploadAdmissionFailure.UserQuota => "Wykorzystano limit miejsca dla tego konta.",
            UploadAdmissionFailure.InstanceQuota => "Instancja wykorzystała skonfigurowany limit miejsca na załączniki.",
            UploadAdmissionFailure.LowDiskSpace =>
                "Serwer zachowuje rezerwę wolnego miejsca potrzebną bazie danych i logom.",
            _ => "Serwer nie może teraz przyjąć kolejnego załącznika.",
        });

    private static IResult Invalid(string field, string message) =>
        Results.ValidationProblem(new Dictionary<string, string[]> { [field] = [message] });

    /// <summary>
    /// The name a recipient downloads the file as. The extension comes from the
    /// verified type, never from the submitted name, so that a PDF cannot be
    /// handed out as <c>invoice.exe</c>.
    /// </summary>
    private static string SafeFileName(string submittedName, UploadSpec spec)
    {
        var stem = Path.GetFileNameWithoutExtension(Path.GetFileName(submittedName));
        var safeStem = new string(stem
            .Where(value => char.IsLetterOrDigit(value) || value is ' ' or '-' or '_' or '.')
            .Take(MaximumFileNameStemLength)
            .ToArray())
            .Trim(' ', '.');
        return $"{(safeStem.Length == 0 ? "attachment" : safeStem)}{spec.Extension}";
    }
}
