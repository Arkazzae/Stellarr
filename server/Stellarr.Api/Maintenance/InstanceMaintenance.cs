using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;
using Stellarr.Api.Logging;
using Stellarr.Api.Storage;

namespace Stellarr.Api.Maintenance;

/// <param name="Enabled">False when the owner switched automatic cleanup off.</param>
/// <param name="PendingObjectDeletions">Objects still waiting in the deletion queue after the run.</param>
public sealed record MaintenanceResult(
    bool Enabled,
    int OrphanAttachments,
    int BackupFiles,
    int LogFiles,
    int PendingObjectDeletions);

/// <summary>
/// One pass of the housekeeping that keeps an instance from growing without
/// bound: it compacts the message journal, removes uploads nobody uses, and
/// prunes old backups and logs.
/// </summary>
public sealed class InstanceMaintenance(
    AppDbContext db,
    MediaStorage mediaStorage,
    IConfiguration configuration,
    IOptions<MaintenanceOptions> options,
    ILogger<InstanceMaintenance> logger)
{
    private int BatchSize => Math.Clamp(options.Value.BatchSize, 1, 1_000);

    /// <param name="utcNow">The instant every age is measured against.</param>
    public async Task<MaintenanceResult> RunAsync(DateTime utcNow, CancellationToken cancellationToken)
    {
        await CompactJournalAsync(
            utcNow.AddDays(-Math.Clamp(options.Value.MessageChangeRetentionDays, 7, 365)),
            utcNow,
            cancellationToken);

        var settings = await db.OperationsSettings.AsNoTracking()
            .OrderByDescending(x => x.UpdatedAt)
            .FirstOrDefaultAsync(cancellationToken) ?? new OperationsSettings();
        if (!settings.AutomaticCleanupEnabled)
        {
            // Explicit deletes and failed upload rollbacks are correctness, not
            // retention, so they are carried out whatever the owner chose.
            await mediaStorage.DrainDeletionQueueAsync(BatchSize, cancellationToken);
            return new MaintenanceResult(false, 0, 0, 0, await PendingDeletionsAsync(cancellationToken));
        }

        var orphans = await QueueOrphansAsync(
            Cutoff(utcNow, settings.OrphanObjectRetentionDays),
            utcNow,
            cancellationToken);
        await mediaStorage.DrainDeletionQueueAsync(BatchSize, cancellationToken);

        var dataRoot = configuration["DataRoot"] ?? "data";
        var backups = PruneFiles(
            Path.Combine(dataRoot, "backups"),
            Cutoff(utcNow, settings.BackupRetentionDays),
            "backup");
        var logs = PruneFiles(
            Path.Combine(dataRoot, "logs"),
            Cutoff(utcNow, settings.LogRetentionDays),
            "log");

        await CleanupExpiredSecurityAsync(utcNow, cancellationToken);

        return new MaintenanceResult(true, orphans, backups, logs, await PendingDeletionsAsync(cancellationToken));
    }

    /// <summary>
    /// Short-lived authentication records are deleted once they are well past
    /// use; the durable security history stays account-global.
    /// </summary>
    private async Task CleanupExpiredSecurityAsync(DateTime utcNow, CancellationToken cancellationToken)
    {
        var ephemeral = utcNow.AddDays(-1);
        await db.AuthChallenges.Where(x => x.ExpiresAt < ephemeral).ExecuteDeleteAsync(cancellationToken);
        await db.EmailOtpCodes.Where(x => x.ExpiresAt < ephemeral).ExecuteDeleteAsync(cancellationToken);
        await db.CliRecoveryCredentials.Where(x => x.ExpiresAt < ephemeral).ExecuteDeleteAsync(cancellationToken);

        var oldDevices = utcNow.AddDays(-30);
        await db.TrustedDevices.Where(x => x.ExpiresAt < oldDevices).ExecuteDeleteAsync(cancellationToken);
        await db.RecoveryCodes
            .Where(x => x.UsedAt != null && x.UsedAt < oldDevices)
            .ExecuteDeleteAsync(cancellationToken);
        await db.SecurityNotifications
            .Where(x => x.SentAt != null && x.SentAt < oldDevices)
            .ExecuteDeleteAsync(cancellationToken);
    }

    private static DateTime Cutoff(DateTime utcNow, int retentionDays) =>
        utcNow.AddDays(-Math.Clamp(retentionDays, 1, 3_650));

    /// <summary>
    /// Deletes journal entries older than the cutoff. A reset entry per affected
    /// channel stays behind, so a client whose cursor points into the removed
    /// range is told to reload instead of silently missing changes.
    /// </summary>
    /// <remarks>
    /// The transaction opens with a write on purpose. SQLite refuses to upgrade
    /// a read snapshot to a write once another connection has committed in
    /// between, and it does so at once, without waiting for the busy timeout.
    /// Taking the write lock with the first statement leaves no such window.
    /// </remarks>
    private async Task CompactJournalAsync(DateTime cutoff, DateTime compactedAt, CancellationToken cancellationToken)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
            INSERT INTO "MessageChanges" ("ChannelId", "MessageId", "Kind", "CreatedAt")
            SELECT DISTINCT "ChannelId", {Guid.Empty}, {(int)MessageChangeKind.Reset}, {compactedAt}
            FROM "MessageChanges"
            WHERE "CreatedAt" < {cutoff};
            """,
            cancellationToken);
        await db.MessageChanges.Where(x => x.CreatedAt < cutoff).ExecuteDeleteAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }

    /// <returns>How many attachments were removed and their objects queued for deletion.</returns>
    private async Task<int> QueueOrphansAsync(DateTime cutoff, DateTime queuedAt, CancellationToken cancellationToken)
    {
        // Avatars, banners and server icons are spared by the storage service,
        // which looks at the address that names them.
        var orphanIds = await db.ImageAttachments.AsNoTracking()
            .Where(x => x.CreatedAt < cutoff &&
                !db.MessageAttachments.Any(link => link.AttachmentId == x.Id) &&
                !db.DirectMessageAttachments.Any(link => link.AttachmentId == x.Id) &&
                !db.MessageEmbeds.Any(embed => embed.ThumbnailAttachmentId == x.Id) &&
                !db.SoundboardSounds.Any(sound => sound.AttachmentId == x.Id))
            .OrderBy(x => x.CreatedAt)
            .Select(x => x.Id)
            .Take(BatchSize)
            .ToListAsync(cancellationToken);

        var removed = 0;
        foreach (var id in orphanIds)
        {
            if (await mediaStorage.QueueAttachmentIfUnreferencedAsync(
                    $"/assets/{id}",
                    uploadedById: null,
                    queuedAt,
                    cancellationToken))
            {
                removed++;
            }
        }

        return removed;
    }

    private int PruneFiles(string directory, DateTime cutoff, string kind)
    {
        if (!Directory.Exists(directory))
        {
            return 0;
        }

        var pruned = 0;
        foreach (var path in Directory.EnumerateFiles(directory))
        {
            try
            {
                if (File.GetLastWriteTimeUtc(path) < cutoff)
                {
                    File.Delete(path);
                    pruned++;
                }
            }
            catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
            {
                MaintenanceLog.FileDeleteFailed(logger, exception, kind, path);
            }
        }

        return pruned;
    }

    private Task<int> PendingDeletionsAsync(CancellationToken cancellationToken) =>
        db.ObjectDeletions.CountAsync(cancellationToken);
}
