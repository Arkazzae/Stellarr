using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Contracts;
using Stellarr.Api.Data;

namespace Stellarr.Api.Endpoints;

/// <summary>Where a person has read up to in each text channel.</summary>
public static class ChannelReadEndpoints
{
    /// <summary>
    /// Moves the marker forward to <paramref name="readAt"/>, and leaves it
    /// where it is when it is already later: a slow request must not win
    /// against a newer one, and the database decides which is newer.
    /// </summary>
    /// <returns>The time that was offered, which is not necessarily the stored one.</returns>
    internal static async Task<ChannelReadDto> AdvanceAsync(
        AppDbContext db,
        Guid channelId,
        Guid userId,
        DateTime readAt,
        CancellationToken cancellationToken)
    {
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
            INSERT INTO "ChannelReads" ("ChannelId", "UserId", "LastReadAt")
            VALUES ({channelId}, {userId}, {readAt})
            ON CONFLICT ("ChannelId", "UserId") DO UPDATE
            SET "LastReadAt" = MAX("ChannelReads"."LastReadAt", excluded."LastReadAt");
            """,
            cancellationToken);
        return new ChannelReadDto(channelId.ToString(), readAt.AsUtc());
    }
}
