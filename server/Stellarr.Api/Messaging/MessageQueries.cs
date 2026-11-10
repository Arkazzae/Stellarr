using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Domain;

namespace Stellarr.Api.Messaging;

public static class MessageQueries
{
    /// <summary>
    /// Loads everything a message needs to be turned into a MessageDto: its
    /// author, attachments, embeds and reactions, and the author and
    /// attachments of the message it answers. The graph is wide, so queries
    /// that page through many messages should also split the query.
    /// </summary>
    public static IQueryable<Message> WithMessageDetails(this IQueryable<Message> messages) =>
        messages
            .Include(x => x.Author)
            .Include(x => x.Attachments).ThenInclude(x => x.Attachment)
            .Include(x => x.Embeds)
            .Include(x => x.Reactions)
            .Include(x => x.ReplyToMessage).ThenInclude(x => x!.Author)
            .Include(x => x.ReplyToMessage).ThenInclude(x => x!.Attachments);

    /// <summary>Loads the author and attachments a direct message needs to become a MessageDto.</summary>
    public static IQueryable<DirectMessage> WithMessageDetails(this IQueryable<DirectMessage> messages) =>
        messages
            .Include(x => x.Author)
            .Include(x => x.Attachments).ThenInclude(x => x.Attachment);

    /// <summary>
    /// The channel when it is a text channel of the given server, and nothing
    /// otherwise. A channel of another server is as good as absent.
    /// </summary>
    public static IQueryable<Channel> TextChannelOnServer(
        this IQueryable<Channel> channels,
        Guid channelId,
        Guid serverId) =>
        channels.Where(x => x.Id == channelId && x.ServerId == serverId && x.Kind == ChannelKind.Text);
}
