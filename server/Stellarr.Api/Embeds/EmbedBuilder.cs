using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;
using Stellarr.Api.Logging;
using Stellarr.Api.Storage;

namespace Stellarr.Api.Embeds;

/// <summary>
/// Turns the links of one message into <see cref="MessageEmbed"/> rows.
/// </summary>
/// <remarks>
/// Embeds are derived data: the message body is all a person wrote. Building
/// replaces the whole set of a message, so running it twice on the same
/// message ends in the same state and never in duplicates. It runs off the
/// request thread, so a slow page cannot slow down a send.
/// </remarks>
public sealed class EmbedBuilder(
    AppDbContext db,
    ILinkUnfurler unfurler,
    IYouTubeMetadataResolver youTube,
    IObjectStorage storage,
    MediaStorage media,
    IOptions<EmbedOptions> options,
    ILogger<EmbedBuilder> logger)
{
    private readonly EmbedOptions _options = options.Value;

    /// <summary>An embed with the preview image that was stored for it, if any.</summary>
    private sealed record Built(MessageEmbed Embed, ImageAttachment? Thumbnail);

    /// <summary>
    /// Rebuilds the embeds of a message and returns them. Empty when the message
    /// has no link worth a card, or does not exist any more.
    /// </summary>
    public async Task<IReadOnlyList<MessageEmbed>> BuildAsync(Guid messageId, CancellationToken cancellationToken)
    {
        var content = await db.Messages.AsNoTracking()
            .Where(x => x.Id == messageId)
            .Select(x => x.Content)
            .SingleOrDefaultAsync(cancellationToken);
        if (content is null)
        {
            return [];
        }

        List<Built> built = [];
        Guid[] replacedThumbnails;
        try
        {
            var links = LinkExtractor.Extract(content, _options.MaxPerMessage);
            for (var position = 0; position < links.Count; position++)
            {
                if (await BuildOneAsync(messageId, links[position], position, cancellationToken) is { } embed)
                {
                    built.Add(embed);
                }
            }

            replacedThumbnails = await ReplaceAsync(messageId, built, cancellationToken);
        }
        catch
        {
            // Images already stored belong to no row, and would stay forever.
            await media.RollbackAsync(built.Select(x => x.Thumbnail?.ObjectKey));
            throw;
        }

        await DiscardThumbnailsAsync(replacedThumbnails, cancellationToken);
        return [.. built.Select(x => x.Embed)];
    }

    /// <summary>
    /// Removes the embeds of a message, and the preview images nothing else uses.
    /// </summary>
    public async Task ClearAsync(Guid messageId, CancellationToken cancellationToken)
    {
        var replaced = await ReplaceAsync(messageId, [], cancellationToken);
        await DiscardThumbnailsAsync(replaced, cancellationToken);
    }

    private async Task<Built?> BuildOneAsync(Guid messageId, Uri url, int position, CancellationToken cancellationToken)
    {
        // GIPHY requires the viewer's own client to talk to it, so the link
        // stays in the message for the client to resolve and is neither
        // fetched nor cached here.
        if (GiphyLinks.TryParse(url, out _))
        {
            return null;
        }

        // A video link is an embed from the moment it is recognised. Whether
        // the host answers our request only decides how the card reads.
        var isVideo = VideoLinks.TryParse(url, out var video);
        var card = await ReadCardAsync(url, video, cancellationToken);
        if (!isVideo && card is null or { Title: null, Description: null, ImageUrl: null })
        {
            // A page that says nothing about itself is worse than the link
            // the reader can already see.
            return null;
        }

        var domain = LinkExtractor.DomainOf(url);
        var thumbnail = card?.ImageUrl is { } imageUrl && Uri.TryCreate(imageUrl, UriKind.Absolute, out var image)
            ? await StoreThumbnailAsync(image, cancellationToken)
            : null;
        var embed = new MessageEmbed
        {
            Id = Guid.NewGuid(),
            MessageId = messageId,
            Url = url.ToString(),
            Kind = isVideo ? EmbedKind.Video : EmbedKind.Link,
            Provider = video?.Provider ?? domain,
            ProviderId = video?.Id,
            StartSeconds = video?.StartSeconds,
            Domain = domain,
            Title = card?.Title,
            Description = card?.Description,
            ThumbnailAttachmentId = thumbnail?.Id,
            Position = position,
            CreatedAt = DateTime.UtcNow,
        };
        return new Built(embed, thumbnail);
    }

    private async Task<PageCard?> ReadCardAsync(Uri url, VideoLink? video, CancellationToken cancellationToken)
    {
        if (!_options.Enabled)
        {
            return null;
        }

        // YouTube is asked through its own endpoint and never read as an
        // ordinary page, which is how a real video once turned into a blank player.
        return video is { Provider: VideoLinks.YouTube }
            ? await youTube.FetchAsync(video, cancellationToken)
            : await unfurler.FetchCardAsync(url, cancellationToken);
    }

    /// <summary>
    /// Copies a preview image into our own storage. The copy is the point:
    /// putting the other host's address in an <c>img</c> tag would tell it who
    /// reads this channel, and when.
    /// </summary>
    /// <returns>The attachment to insert, or null when no image could be stored.</returns>
    private async Task<ImageAttachment?> StoreThumbnailAsync(Uri url, CancellationToken cancellationToken)
    {
        var fetched = await unfurler.FetchImageAsync(url, cancellationToken);
        if (fetched is null)
        {
            return null;
        }

        var id = Guid.NewGuid();
        var objectKey = $"embeds/{DateTime.UtcNow:yyyy/MM}/{id:N}{Path.GetExtension(fetched.FileName)}";
        try
        {
            using var content = new MemoryStream(fetched.Bytes, writable: false);
            await storage.PutAsync(objectKey, content, fetched.ContentType, cancellationToken);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            EmbedLog.ThumbnailFailed(logger, exception, url);
            return null;
        }

        // Uploaded by nobody in particular. The row exists so that /assets can
        // serve the image, and naming the sender would charge a link they
        // pasted against their upload quota.
        return new ImageAttachment
        {
            Id = id,
            UploadedById = Guid.Empty,
            ObjectKey = objectKey,
            FileName = fetched.FileName,
            ContentType = fetched.ContentType,
            SizeBytes = fetched.Bytes.Length,
            CreatedAt = DateTime.UtcNow,
        };
    }

    /// <summary>
    /// Swaps the embeds of a message for <paramref name="built"/> in one
    /// transaction, so that nobody reads it with the old set gone and the new
    /// one not there yet.
    /// </summary>
    /// <returns>The preview images the old embeds used.</returns>
    private async Task<Guid[]> ReplaceAsync(Guid messageId, List<Built> built, CancellationToken cancellationToken)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var replaced = await db.MessageEmbeds
            .Where(x => x.MessageId == messageId && x.ThumbnailAttachmentId != null)
            .Select(x => x.ThumbnailAttachmentId!.Value)
            .Distinct()
            .ToArrayAsync(cancellationToken);
        await db.MessageEmbeds.Where(x => x.MessageId == messageId).ExecuteDeleteAsync(cancellationToken);

        // A bulk delete does not reach the change tracker, which would go on
        // believing in the rows it removed, and null their references when the
        // images they used are deleted.
        foreach (var gone in db.ChangeTracker.Entries<MessageEmbed>().Where(x => x.Entity.MessageId == messageId).ToList())
        {
            gone.State = EntityState.Detached;
        }

        db.ImageAttachments.AddRange(built.Select(x => x.Thumbnail).OfType<ImageAttachment>());
        db.MessageEmbeds.AddRange(built.Select(x => x.Embed));
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return replaced;
    }

    /// <summary>
    /// Deletes the preview images that no embed, attachment, avatar or icon
    /// uses any more, from the database and from storage.
    /// </summary>
    private async Task DiscardThumbnailsAsync(Guid[] thumbnailIds, CancellationToken cancellationToken)
    {
        if (thumbnailIds.Length == 0)
        {
            return;
        }

        // Only images this builder stored: they have no uploader.
        var candidates = await db.ImageAttachments.AsNoTracking()
            .Where(x => thumbnailIds.Contains(x.Id) && x.UploadedById == Guid.Empty)
            .Select(x => new { x.Id, x.ObjectKey })
            .ToListAsync(cancellationToken);
        foreach (var thumbnail in candidates)
        {
            // The object is queued for deletion together with its row, so that
            // an unreachable store cannot leave it behind. It is then deleted
            // at once and taken off the queue.
            var removed = await media.QueueAttachmentIfUnreferencedAsync(
                $"/assets/{thumbnail.Id}", Guid.Empty, DateTime.UtcNow, cancellationToken);
            if (removed)
            {
                await DeleteObjectAsync(thumbnail.ObjectKey, cancellationToken);
            }
        }
    }

    private async Task DeleteObjectAsync(string objectKey, CancellationToken cancellationToken)
    {
        try
        {
            await storage.DeleteAsync(objectKey, cancellationToken);
            await db.ObjectDeletions.Where(x => x.ObjectKey == objectKey).ExecuteDeleteAsync(cancellationToken);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            EmbedLog.ThumbnailDeleteFailed(logger, exception, objectKey);
        }
    }
}
