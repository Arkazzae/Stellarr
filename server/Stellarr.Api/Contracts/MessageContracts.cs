using Stellarr.Api.Domain;

namespace Stellarr.Api.Contracts;

public sealed record AttachmentDto(
    string Id,
    string Name,
    string ContentType,
    long Size,
    int? Width,
    int? Height,
    string Url,
    double? DurationSeconds,
    string? PosterUrl,
    bool IsVoiceMessage);

/// <summary>An unfurled link under a message.</summary>
/// <param name="Kind">"link" for a card, "video" for something with a player.</param>
/// <param name="Provider">"youtube", "vimeo", or the host.</param>
/// <param name="ProviderId">The video id a player needs; null for a card.</param>
/// <param name="ThumbnailUrl">Always one of our own /assets URLs, never a third party's.</param>
public sealed record MessageEmbedDto(
    string Id,
    string Url,
    string Kind,
    string Provider,
    string? ProviderId,
    int? StartSeconds,
    string Domain,
    string? Title,
    string? Description,
    string? ThumbnailUrl);

/// <summary>
/// Pushed when the embeds of a message have been rebuilt, after the message
/// itself was delivered. An empty list means it has none (any more).
/// </summary>
public sealed record MessageEmbedsDto(
    string MessageId,
    string ChannelId,
    IReadOnlyList<MessageEmbedDto> Embeds);

public sealed record MessageReactionDto(string Emoji, int Count, bool Mine);

/// <summary>
/// Pushed when somebody adds or removes a reaction, and answered to the one
/// who did. The count is the total for that emoji after the change.
/// </summary>
/// <param name="Added">False when the reaction was taken back.</param>
public sealed record MessageReactionChangedDto(
    string MessageId,
    string ChannelId,
    string Emoji,
    int Count,
    string UserId,
    bool Added);

public sealed record MessageReferenceDto(
    string Id,
    string AuthorId,
    string AuthorName,
    string Preview,
    bool HasAttachment);

/// <param name="EditedAt">Null until the author rewrites it.</param>
/// <param name="PinnedAt">When it was pinned to the channel, or null if it is not.</param>
/// <param name="ReplyTo">A short reference to the message this one answers.</param>
public sealed record MessageDto(
    string Id,
    string ChannelId,
    UserDto Author,
    string Content,
    DateTime CreatedAt,
    IReadOnlyList<AttachmentDto> Attachments,
    IReadOnlyList<MessageEmbedDto> Embeds,
    DateTime? EditedAt,
    DateTime? PinnedAt = null,
    MessageReferenceDto? ReplyTo = null,
    IReadOnlyList<MessageReactionDto>? Reactions = null);

/// <param name="Content">Required; a null is answered like an empty text.</param>
/// <param name="ReplyToMessageId">A message of the same channel this one answers.</param>
/// <param name="ClientMessageId">
/// The identity the client picked for the message, so that a retried send is
/// recognised as the same send rather than posted twice.
/// </param>
public sealed record CreateMessageRequest(
    string? Content,
    IReadOnlyList<Guid>? AttachmentIds,
    Guid? ReplyToMessageId = null,
    Guid? ClientMessageId = null);

/// <summary>
/// A rewrite of a sent message. Text only: the attachments a message went out
/// with stay, so that a picture cannot be swapped after people reacted to it.
/// </summary>
/// <param name="Content">Required; a null is answered like an empty text.</param>
public sealed record EditMessageRequest(string? Content);

/// <summary>
/// Pushed when a message is removed. It names the channel as well, so that a
/// client can drop the message without knowing which transcript held it.
/// </summary>
public sealed record MessageDeletedDto(string MessageId, string ChannelId);

/// <summary>
/// One page of a channel's history, oldest message first, so that a client can
/// prepend the whole array without reversing it.
/// </summary>
/// <param name="NextCursor">Opaque; null once the beginning of the channel has been reached.</param>
/// <param name="SyncCursor">
/// The journal position the page was read at, where a client resumes
/// listening for changes.
/// </param>
public sealed record MessageHistoryPageDto(
    IReadOnlyList<MessageDto> Messages,
    string? NextCursor,
    string SyncCursor);

/// <param name="Cursor">The journal position of this change, to resume from.</param>
/// <param name="Kind">"upsert" with the message as it is now, or "delete" with none.</param>
public sealed record MessageSyncChangeDto(
    string Cursor,
    string Kind,
    string MessageId,
    MessageDto? Message);

/// <summary>Changes of one channel after a journal position, oldest first.</summary>
/// <param name="NextCursor">Where to ask next; the position asked from when nothing changed.</param>
/// <param name="ResetRequired">
/// Set when the journal no longer reaches back far enough, and the client
/// has to load the history again instead of replaying changes.
/// </param>
public sealed record MessageSyncPageDto(
    IReadOnlyList<MessageSyncChangeDto> Changes,
    string NextCursor,
    bool HasMore,
    bool ResetRequired);

/// <summary>A person's read watermark in one text channel.</summary>
public sealed record ChannelReadDto(string ChannelId, DateTime LastReadAt);

public static class MessageContractMappings
{
    private const int PreviewLength = 160;

    /// <summary>The author clients see on server notices, so that they offer no person-only actions.</summary>
    private static readonly UserDto SystemAuthor = new("system", "system", "system", "#777777", "online");

    public static AttachmentDto ToDto(this ImageAttachment attachment) => new(
        attachment.Id.ToString(),
        attachment.FileName,
        attachment.ContentType,
        attachment.SizeBytes,
        attachment.Width,
        attachment.Height,
        $"/assets/{attachment.Id}",
        attachment.DurationSeconds,
        attachment.PosterObjectKey is null ? null : $"/assets/{attachment.Id}/poster",
        attachment.IsVoiceMessage);

    public static MessageEmbedDto ToDto(this MessageEmbed embed) => new(
        embed.Id.ToString(),
        embed.Url,
        embed.Kind == EmbedKind.Video ? "video" : "link",
        embed.Provider,
        embed.ProviderId,
        embed.StartSeconds,
        embed.Domain,
        embed.Title,
        embed.Description,
        embed.ThumbnailAttachmentId is { } thumbnailId ? $"/assets/{thumbnailId}" : null);

    /// <summary>
    /// The message with everything a transcript shows. It needs the graph that
    /// <c>MessageQueries.WithMessageDetails</c> loads; reactions are counted
    /// for everybody and flagged for <paramref name="viewerId"/>.
    /// </summary>
    public static MessageDto ToDto(this Message message, Guid? viewerId = null) => new(
        message.Id.ToString(),
        message.ChannelId.ToString(),
        message.IsSystem ? SystemAuthor : message.Author.ToDto("online"),
        message.Content,
        message.CreatedAt.AsUtc(),
        message.Attachments.Select(x => x.Attachment.ToDto()).ToArray(),
        message.Embeds.OrderBy(x => x.Position).Select(x => x.ToDto()).ToArray(),
        message.EditedAt.AsUtc(),
        message.PinnedAt.AsUtc(),
        message.ReplyToMessage?.ToReferenceDto(),
        message.Reactions
            .GroupBy(x => x.Emoji, StringComparer.Ordinal)
            .OrderBy(group => group.Min(reaction => reaction.CreatedAt))
            .Select(group => new MessageReactionDto(
                group.Key,
                group.Count(),
                viewerId is { } viewer && group.Any(reaction => reaction.UserId == viewer)))
            .ToArray());

    /// <summary>The one-line quote shown above a reply.</summary>
    public static MessageReferenceDto ToReferenceDto(this Message message)
    {
        var preview = string.Join(' ', message.Content.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
        if (preview.Length > PreviewLength)
        {
            preview = $"{preview[..(PreviewLength - 3)]}…";
        }

        var hasAttachment = message.Attachments.Count > 0;
        if (preview.Length == 0 && hasAttachment)
        {
            preview = "Załącznik";
        }

        return new MessageReferenceDto(
            message.Id.ToString(),
            message.IsSystem ? SystemAuthor.Id : message.AuthorId.ToString(),
            message.IsSystem ? SystemAuthor.DisplayName : message.Author.DisplayName,
            preview,
            hasAttachment);
    }
}

internal static class UtcDates
{
    /// <summary>
    /// SQLite hands dates back without a kind, but every stored date is UTC,
    /// and the wire format only stays unambiguous when it says so.
    /// </summary>
    internal static DateTime AsUtc(this DateTime value) =>
        value.Kind == DateTimeKind.Utc ? value : DateTime.SpecifyKind(value, DateTimeKind.Utc);

    internal static DateTime? AsUtc(this DateTime? value) => value?.AsUtc();
}
