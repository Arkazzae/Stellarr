using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;

namespace Stellarr.Api.Embeds;

/// <summary>Queues the derived rows that an older build left incomplete.</summary>
public static class EmbedRecovery
{
    private const int BatchSize = 256;

    /// <summary>
    /// Before YouTube had a resolver of its own, its links were read as
    /// ordinary pages and came out as a player with no title and no thumbnail.
    /// Embeds are derived data, so rebuilding those is safe, and it makes the
    /// upgrade visible without asking anybody to repost.
    /// </summary>
    public static async Task EnqueueStaleYouTubeAsync(
        AppDbContext db,
        EmbedInbox inbox,
        CancellationToken cancellationToken)
    {
        var stale = await db.Messages.AsNoTracking()
            .Where(message => message.Embeds.Any(embed =>
                embed.Kind == EmbedKind.Video &&
                embed.Provider == VideoLinks.YouTube &&
                embed.Title == null &&
                embed.ThumbnailAttachmentId == null))
            .OrderBy(message => message.Id)
            .Select(message => new EmbedRequest(message.ChannelId, message.Id))
            .Take(BatchSize)
            .ToListAsync(cancellationToken);

        foreach (var request in stale)
        {
            inbox.Enqueue(request);
        }
    }
}
