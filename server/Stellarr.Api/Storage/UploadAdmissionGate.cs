using System.Diagnostics.CodeAnalysis;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Stellarr.Api.Data;

namespace Stellarr.Api.Storage;

public enum UploadAdmissionFailure
{
    None,
    UserQuota,
    InstanceQuota,
    LowDiskSpace,
}

/// <param name="Lease">Holds the reservation until it is disposed. Null when the upload was refused.</param>
public sealed record UploadAdmission(UploadAdmissionFailure Failure, IAsyncDisposable? Lease)
{
    [MemberNotNullWhen(true, nameof(Lease))]
    public bool Accepted => Failure == UploadAdmissionFailure.None && Lease is not null;
}

/// <summary>
/// Reserves room for an upload before any of its bytes are copied to object
/// storage. The process is the only writer to the database, so reserving here
/// closes the gap between reading the stored totals and committing the row
/// that adds to them.
/// </summary>
public sealed class UploadAdmissionGate : IDisposable
{
    private readonly UploadOptions _options;
    private readonly string _dataRoot;
    private readonly SemaphoreSlim _slots;

    // Guards the reservations below, and makes the check and the reservation one step.
    private readonly SemaphoreSlim _ledger = new(1, 1);
    private readonly Dictionary<Guid, long> _reservedByUser = [];
    private long _reservedTotal;

    public UploadAdmissionGate(IOptions<UploadOptions> options, IConfiguration configuration)
    {
        _options = options.Value;
        var slots = Math.Clamp(_options.MaxConcurrentUploads, 1, 32);
        _slots = new SemaphoreSlim(slots, slots);
        _dataRoot = Path.GetFullPath(configuration["DataRoot"] ?? "data");
    }

    public async Task<UploadAdmission> TryEnterAsync(
        AppDbContext db,
        Guid userId,
        long requestedBytes,
        CancellationToken cancellationToken)
    {
        await _slots.WaitAsync(cancellationToken);
        var leased = false;
        try
        {
            await _ledger.WaitAsync(cancellationToken);
            try
            {
                var failure = await FindFailureAsync(db, userId, requestedBytes, cancellationToken);
                if (failure != UploadAdmissionFailure.None)
                {
                    return new UploadAdmission(failure, null);
                }

                _reservedTotal = checked(_reservedTotal + requestedBytes);
                _reservedByUser[userId] = checked(_reservedByUser.GetValueOrDefault(userId) + requestedBytes);
                leased = true;
                return new UploadAdmission(UploadAdmissionFailure.None, new Lease(this, userId, requestedBytes));
            }
            finally
            {
                _ledger.Release();
            }
        }
        finally
        {
            if (!leased)
            {
                _slots.Release();
            }
        }
    }

    public void Dispose()
    {
        _slots.Dispose();
        _ledger.Dispose();
    }

    private async Task<UploadAdmissionFailure> FindFailureAsync(
        AppDbContext db,
        Guid userId,
        long requestedBytes,
        CancellationToken cancellationToken)
    {
        var attachments = db.ImageAttachments.AsNoTracking();
        var userStored = await attachments
            .Where(x => x.UploadedById == userId)
            .SumAsync(x => (long?)x.SizeBytes + (x.PosterSizeBytes ?? 0), cancellationToken) ?? 0;
        var totalStored = await attachments
            .SumAsync(x => (long?)x.SizeBytes + (x.PosterSizeBytes ?? 0), cancellationToken) ?? 0;

        var userReserved = _reservedByUser.GetValueOrDefault(userId);
        if (WouldExceed(userStored, userReserved, requestedBytes, _options.MaxStoredBytesPerUser))
        {
            return UploadAdmissionFailure.UserQuota;
        }

        if (WouldExceed(totalStored, _reservedTotal, requestedBytes, _options.MaxStoredBytes))
        {
            return UploadAdmissionFailure.InstanceQuota;
        }

        return HasDiskHeadroom(requestedBytes) ? UploadAdmissionFailure.None : UploadAdmissionFailure.LowDiskSpace;
    }

    /// <summary>
    /// Whether stored, reserved and requested bytes together pass the limit, written
    /// as subtractions so that no sum can overflow. A limit of zero or less is no limit.
    /// </summary>
    private static bool WouldExceed(long stored, long reserved, long requested, long limit) =>
        limit > 0 && (requested > limit || stored > limit - requested || reserved > limit - requested - stored);

    private bool HasDiskHeadroom(long requestedBytes)
    {
        var minimum = Math.Max(0, _options.MinimumFreeDataRootBytes);
        if (minimum == 0)
        {
            return true;
        }

        try
        {
            // The volume with the longest mount path that holds the data root.
            var volume = DriveInfo.GetDrives()
                .Where(drive => _dataRoot.StartsWith(drive.RootDirectory.FullName, StringComparison.Ordinal))
                .MaxBy(drive => drive.RootDirectory.FullName.Length);
            if (volume is null)
            {
                return true;
            }

            if (requestedBytes > long.MaxValue - minimum ||
                _reservedTotal > long.MaxValue - minimum - requestedBytes)
            {
                return false;
            }

            return volume.AvailableFreeSpace >= minimum + requestedBytes + _reservedTotal;
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            // A remote data root may not report its capacity. The stored-bytes
            // quotas still apply, and an unreadable volume is no reason to refuse uploads.
            return true;
        }
    }

    private async ValueTask ReleaseAsync(Guid userId, long bytes)
    {
        await _ledger.WaitAsync();
        try
        {
            _reservedTotal -= bytes;
            var remaining = _reservedByUser.GetValueOrDefault(userId) - bytes;
            if (remaining <= 0)
            {
                _reservedByUser.Remove(userId);
            }
            else
            {
                _reservedByUser[userId] = remaining;
            }
        }
        finally
        {
            _ledger.Release();
            _slots.Release();
        }
    }

    private sealed class Lease(UploadAdmissionGate owner, Guid userId, long bytes) : IAsyncDisposable
    {
        private int _released;

        public ValueTask DisposeAsync() =>
            Interlocked.Exchange(ref _released, 1) == 0
                ? owner.ReleaseAsync(userId, bytes)
                : ValueTask.CompletedTask;
    }
}
