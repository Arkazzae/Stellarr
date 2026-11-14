using System.Diagnostics.CodeAnalysis;
using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;
using Stellarr.Api.Logging;

namespace Stellarr.Api.Storage;

public enum UploadFailure
{
    None,
    Empty,
    TooLarge,
    UnsupportedType,
    SignatureMismatch,
}

/// <param name="Spec">What the file claims to be, once its type is known and supported.</param>
public sealed record UploadInspection(UploadFailure Failure, UploadSpec? Spec)
{
    [MemberNotNullWhen(true, nameof(Spec))]
    public bool Accepted => Failure == UploadFailure.None && Spec is not null;
}

/// <summary>
/// The one way media enters and leaves object storage: it validates a file,
/// writes it, and records the deletion of objects durably so that neither a
/// cancelled request nor an unreachable store leaves one behind. Endpoints keep
/// their own messages and metadata.
/// </summary>
public sealed class MediaStorage(AppDbContext db, IObjectStorage storage, ILogger<MediaStorage> logger)
{
    private const string AssetUrlPrefix = "/assets/";

    // Enough for the longest signature that is checked.
    private const int HeaderLength = 64;

    public Task<UploadInspection> InspectImageAsync(
        IFormFile file,
        long maximumBytes,
        CancellationToken cancellationToken) =>
        InspectAsync(file, UploadKind.Image, _ => maximumBytes, cancellationToken);

    public Task<UploadInspection> InspectAttachmentAsync(
        IFormFile file,
        UploadOptions options,
        CancellationToken cancellationToken) =>
        InspectAsync(file, null, spec => AttachmentValidation.MaxBytes(spec, options), cancellationToken);

    public async Task StoreAsync(string objectKey, IFormFile file, CancellationToken cancellationToken)
    {
        await using var input = file.OpenReadStream();
        await storage.PutAsync(objectKey, input, cancellationToken);
    }

    /// <summary>
    /// Removes objects whose row never made it into the database. A key that
    /// cannot be deleted now is queued, so it is retried instead of leaked.
    /// </summary>
    public async Task RollbackAsync(IEnumerable<string?> objectKeys)
    {
        var failed = new List<string>();
        foreach (var key in objectKeys.OfType<string>().Distinct(StringComparer.Ordinal))
        {
            try
            {
                // The request that is being rolled back may be the one that was cancelled.
                await storage.DeleteAsync(key, CancellationToken.None);
            }
            catch (Exception exception)
            {
                UploadLog.RollbackDeleteFailed(logger, exception, key);
                failed.Add(key);
            }
        }

        if (failed.Count == 0)
        {
            return;
        }

        // The caller usually arrives here because SaveChanges failed. Drop the
        // rejected graph so that only the small cleanup intent is persisted.
        db.ChangeTracker.Clear();
        try
        {
            await QueueDeletionAsync(failed, DateTime.UtcNow, CancellationToken.None);
            await db.SaveChangesAsync(CancellationToken.None);
        }
        catch (Exception exception)
        {
            UploadLog.RollbackQueueFailed(logger, exception);
        }
    }

    /// <summary>
    /// Deletes the attachment behind an <c>/assets/{id}</c> address, together with its
    /// poster, unless something still points at it.
    /// </summary>
    /// <param name="uploadedById">When set, only an attachment this account uploaded qualifies.</param>
    /// <returns>True when the attachment was removed and its objects queued for deletion.</returns>
    public async Task<bool> QueueAttachmentIfUnreferencedAsync(
        string? assetUrl,
        Guid? uploadedById,
        DateTime queuedAt,
        CancellationToken cancellationToken)
    {
        if (!TryGetAttachmentId(assetUrl, out var attachmentId))
        {
            return false;
        }

        var attachment = await db.ImageAttachments.SingleOrDefaultAsync(
            x => x.Id == attachmentId && (!uploadedById.HasValue || x.UploadedById == uploadedById.Value),
            cancellationToken);
        if (attachment is null || await IsReferencedAsync(attachmentId, assetUrl!, cancellationToken))
        {
            return false;
        }

        await QueueDeletionAsync([attachment.ObjectKey, attachment.PosterObjectKey], queuedAt, cancellationToken);
        db.ImageAttachments.Remove(attachment);
        try
        {
            await db.SaveChangesAsync(cancellationToken);
            return true;
        }
        catch (DbUpdateException exception)
        {
            // A reference may have been added since the check. The cleanup is
            // optional, so keeping the attachment is the safe outcome.
            UploadLog.AttachmentStillReferenced(logger, exception, attachmentId);
            db.ChangeTracker.Clear();
            return false;
        }
    }

    /// <summary>Adds the objects to the deletion queue. The caller saves the context.</summary>
    public async Task QueueDeletionAsync(
        IEnumerable<string?> objectKeys,
        DateTime queuedAt,
        CancellationToken cancellationToken)
    {
        foreach (var key in objectKeys.OfType<string>().Distinct(StringComparer.Ordinal))
        {
            var alreadyQueued = db.ObjectDeletions.Local.Any(x => x.ObjectKey == key) ||
                await db.ObjectDeletions.AnyAsync(x => x.ObjectKey == key, cancellationToken);
            if (!alreadyQueued)
            {
                db.ObjectDeletions.Add(new ObjectDeletion { ObjectKey = key, QueuedAt = queuedAt });
            }
        }
    }

    /// <summary>Deletes the oldest queued objects. One that cannot be deleted stays queued.</summary>
    public async Task DrainDeletionQueueAsync(int batchSize, CancellationToken cancellationToken)
    {
        var deletions = await db.ObjectDeletions
            .OrderBy(x => x.QueuedAt)
            .Take(batchSize)
            .ToListAsync(cancellationToken);

        foreach (var deletion in deletions)
        {
            try
            {
                await storage.DeleteAsync(deletion.ObjectKey, cancellationToken);
                db.ObjectDeletions.Remove(deletion);
                await db.SaveChangesAsync(cancellationToken);
            }
            catch (Exception exception) when (exception is not OperationCanceledException)
            {
                MaintenanceLog.ObjectDeleteFailed(logger, exception, deletion.ObjectKey);
                // Without this a failed save would be retried with the next one.
                db.Entry(deletion).State = EntityState.Unchanged;
            }
        }
    }

    private static async Task<UploadInspection> InspectAsync(
        IFormFile file,
        UploadKind? requiredKind,
        Func<UploadSpec, long> maximumBytes,
        CancellationToken cancellationToken)
    {
        if (file.Length <= 0)
        {
            return new UploadInspection(UploadFailure.Empty, null);
        }

        if (!AttachmentValidation.TryGetSpec(file.ContentType, out var spec) ||
            (requiredKind is { } kind && spec.Kind != kind))
        {
            return new UploadInspection(UploadFailure.UnsupportedType, null);
        }

        if (file.Length > maximumBytes(spec))
        {
            return new UploadInspection(UploadFailure.TooLarge, spec);
        }

        await using var input = file.OpenReadStream();
        var header = new byte[HeaderLength];
        var bytesRead = await input.ReadAsync(header, cancellationToken);
        return new UploadInspection(
            AttachmentValidation.MatchesSignature(spec, header.AsSpan(0, bytesRead))
                ? UploadFailure.None
                : UploadFailure.SignatureMismatch,
            spec);
    }

    private async Task<bool> IsReferencedAsync(
        Guid attachmentId,
        string assetUrl,
        CancellationToken cancellationToken) =>
        await db.MessageAttachments.AsNoTracking().AnyAsync(x => x.AttachmentId == attachmentId, cancellationToken) ||
        await db.MessageEmbeds.AsNoTracking().AnyAsync(x => x.ThumbnailAttachmentId == attachmentId, cancellationToken) ||
        await db.SoundboardSounds.AsNoTracking().AnyAsync(x => x.AttachmentId == attachmentId, cancellationToken) ||
        await db.Users.AsNoTracking().AnyAsync(x => x.AvatarUrl == assetUrl || x.BannerUrl == assetUrl, cancellationToken) ||
        await db.Servers.AsNoTracking().AnyAsync(x => x.IconUrl == assetUrl, cancellationToken);

    private static bool TryGetAttachmentId(string? assetUrl, out Guid attachmentId)
    {
        attachmentId = default;
        return assetUrl is not null &&
            assetUrl.StartsWith(AssetUrlPrefix, StringComparison.Ordinal) &&
            Guid.TryParse(assetUrl.AsSpan(AssetUrlPrefix.Length), out attachmentId);
    }
}
