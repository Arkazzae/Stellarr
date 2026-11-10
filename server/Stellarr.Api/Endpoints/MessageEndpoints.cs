using System.Globalization;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Auth;
using Stellarr.Api.Contracts;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;
using Stellarr.Api.Embeds;
using Stellarr.Api.Messaging;
using Stellarr.Api.Realtime;

namespace Stellarr.Api.Endpoints;

/// <summary>Posting to a text channel, and rewriting or removing what was posted.</summary>
public static class MessageEndpoints
{
    private const int MaxAttachments = 10;

    public static IEndpointRouteBuilder MapMessageEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var api = endpoints.MapGroup("/api")
            .RequireAuthorization()
            .AddEndpointFilter<ServerMembershipFilter>();
        api.MapPost("/channels/{channelId:guid}/messages", CreateAsync);
        api.MapPatch("/messages/{messageId:guid}", EditAsync);
        api.MapDelete("/messages/{messageId:guid}", DeleteAsync);
        return endpoints;
    }

    /// <summary>What a sender asked to post, after trimming and de-duplication.</summary>
    private sealed record Submission(
        Guid ChannelId,
        Guid AuthorId,
        string Content,
        Guid[] AttachmentIds,
        Guid? ReplyToMessageId,
        Guid? ClientMessageId)
    {
        /// <summary>Whether <paramref name="message"/> is what this submission would have produced.</summary>
        public bool Produced(Message message) =>
            message.AuthorId == AuthorId &&
            message.ChannelId == ChannelId &&
            string.Equals(message.Content, Content, StringComparison.Ordinal) &&
            message.ReplyToMessageId == ReplyToMessageId &&
            message.Attachments.Select(x => x.AttachmentId).Order().SequenceEqual(AttachmentIds.Order());
    }

    private static async Task<IResult> CreateAsync(
        Guid channelId,
        CreateMessageRequest request,
        HttpContext http,
        AppDbContext db,
        IHubContext<AppHub> hub,
        SlowModeGate slowMode,
        EmbedInbox embeds,
        CancellationToken cancellationToken)
    {
        if (request.AttachmentIds is { Count: > MaxAttachments })
        {
            return Invalid("attachmentIds", $"Wiadomość może zawierać najwyżej {MaxAttachments} załączników.");
        }

        if (request.ClientMessageId == Guid.Empty)
        {
            return Invalid("clientMessageId", "Identyfikator wiadomości jest nieprawidłowy.");
        }

        var userId = http.User.RequireUserId();
        var submission = new Submission(
            channelId,
            userId,
            request.Content?.Trim() ?? "",
            request.AttachmentIds?.Distinct().ToArray() ?? [],
            request.ReplyToMessageId,
            request.ClientMessageId);
        if ((submission.Content.Length == 0 && submission.AttachmentIds.Length == 0) ||
            submission.Content.Length > MessageLimits.MaxContentLength)
        {
            return Invalid(
                "content",
                "Wiadomość musi zawierać tekst lub załącznik i mieć najwyżej " +
                $"{MessageLimits.MaxContentLength} znaków.");
        }

        var serverId = http.RequireActiveServerId();
        var channel = await db.Channels.AsNoTracking()
            .TextChannelOnServer(channelId, serverId)
            .SingleOrDefaultAsync(cancellationToken);
        if (channel is null)
        {
            return Results.NotFound();
        }

        // A retry of a send that went through must not wait behind slow mode
        // or be refused for the attachments it already used, so it is
        // recognised first.
        if (await ReplayAsync(db, submission, cancellationToken) is { } replay)
        {
            return replay;
        }

        Message? replyTo = null;
        if (submission.ReplyToMessageId is { } replyToId)
        {
            replyTo = await db.Messages
                .Include(x => x.Author)
                .Include(x => x.Attachments)
                .FirstOrDefaultAsync(x => x.Id == replyToId && x.ChannelId == channelId, cancellationToken);
            if (replyTo is null)
            {
                return Invalid(
                    "replyToMessageId",
                    "Odpowiedź musi wskazywać istniejącą wiadomość z tego samego kanału.");
            }
        }

        var attachments = submission.AttachmentIds.Length == 0
            ? []
            : await db.ImageAttachments
                .Where(x => submission.AttachmentIds.Contains(x.Id) && x.UploadedById == userId)
                .ToListAsync(cancellationToken);
        if (attachments.Count != submission.AttachmentIds.Length)
        {
            return Invalid(
                "attachmentIds",
                "Co najmniej jeden załącznik nie istnieje albo należy do innego użytkownika.");
        }

        var enforceSlowMode = channel.SlowModeSeconds > 0 &&
            !await ServerAccess.HasAsync(db, userId, serverId, channelId, ServerPrivileges.ManageChannels, cancellationToken);
        Message message;
        ChannelReadDto read;
        IReadOnlyList<UserNotification> mentions;
        using (await slowMode.EnterAsync(enforceSlowMode, cancellationToken))
        {
            if (enforceSlowMode &&
                await SlowModeWaitAsync(db, channel, userId, cancellationToken) is { } retryAfter)
            {
                http.Response.Headers.RetryAfter = retryAfter.ToString(CultureInfo.InvariantCulture);
                return Results.Problem(
                    statusCode: StatusCodes.Status429TooManyRequests,
                    title: "Tryb powolny jest aktywny",
                    detail: $"Następną wiadomość możesz wysłać za {retryAfter} s.");
            }

            // A recording is a message of its own: no text and nothing beside it.
            if (attachments.Any(x => x.IsVoiceMessage) && (attachments.Count > 1 || submission.Content.Length > 0))
            {
                return Invalid(
                    "attachmentIds",
                    "Wiadomość głosowa musi być wysłana samodzielnie, bez tekstu i innych załączników.");
            }

            message = new Message
            {
                Id = submission.ClientMessageId ?? Guid.NewGuid(),
                ChannelId = channelId,
                AuthorId = userId,
                Author = await db.Users.SingleAsync(x => x.Id == userId, cancellationToken),
                Content = submission.Content,
                CreatedAt = DateTime.UtcNow,
                ReplyToMessageId = replyTo?.Id,
                ReplyToMessage = replyTo,
                Attachments = attachments
                    .Select(x => new MessageAttachment { AttachmentId = x.Id, Attachment = x })
                    .ToList(),
            };
            try
            {
                (read, mentions) = await StoreAsync(db, serverId, message, cancellationToken);
            }
            catch (DbUpdateException exception) when (
                submission.ClientMessageId is not null && DatabaseErrors.IsUniqueConstraint(exception))
            {
                // Another request with the same client id stored it between
                // the check above and the insert.
                db.ChangeTracker.Clear();
                if (await ReplayAsync(db, submission, cancellationToken) is { } raced)
                {
                    return raced;
                }

                throw;
            }
        }

        var response = message.ToDto(userId);
        // The message is stored by now, so a client that hangs up must not
        // keep the others from hearing about it.
        await hub.Clients.Group(AppHub.ServerGroup(serverId))
            .SendAsync("MessageCreated", response, CancellationToken.None);
        await hub.Clients.Group(AppHub.UserGroup(userId))
            .SendAsync("ChannelReadChanged", read, CancellationToken.None);
        await MessageMentions.FanOutAsync(hub, mentions, CancellationToken.None);

        // Last: unfurling talks to hosts we do not control, and no send waits
        // for one of them.
        embeds.Enqueue(new EmbedRequest(channelId, message.Id));

        return Results.Created($"/api/channels/{channelId}/messages/{message.Id}", response);
    }

    /// <summary>
    /// The answer to a send whose client id is already taken: the stored
    /// message when it is the same send again, a conflict when it is not.
    /// Null when nothing is stored under the id.
    /// </summary>
    private static async Task<IResult?> ReplayAsync(
        AppDbContext db,
        Submission submission,
        CancellationToken cancellationToken)
    {
        if (submission.ClientMessageId is not { } clientMessageId)
        {
            return null;
        }

        var existing = await db.Messages.AsNoTracking()
            .WithMessageDetails()
            .AsSplitQuery()
            .SingleOrDefaultAsync(x => x.Id == clientMessageId, cancellationToken);
        if (existing is null)
        {
            return null;
        }

        return submission.Produced(existing) ? Results.Ok(existing.ToDto(submission.AuthorId)) : Results.Conflict();
    }

    /// <summary>
    /// How many whole seconds the author still has to wait in a slow-mode
    /// channel, or null when they may post now.
    /// </summary>
    private static async Task<int?> SlowModeWaitAsync(
        AppDbContext db,
        Channel channel,
        Guid userId,
        CancellationToken cancellationToken)
    {
        var lastMessageAt = await db.Messages.AsNoTracking()
            .Where(x => x.ChannelId == channel.Id && x.AuthorId == userId && !x.IsSystem)
            .MaxAsync(x => (DateTime?)x.CreatedAt, cancellationToken);
        var mayPostAt = lastMessageAt?.AddSeconds(channel.SlowModeSeconds);
        var now = DateTime.UtcNow;
        return mayPostAt > now ? Math.Max(1, (int)Math.Ceiling((mayPostAt.Value - now).TotalSeconds)) : null;
    }

    /// <summary>
    /// Stores the message, moves its author's read marker to it and adds the
    /// inbox entries of the members it mentions, all in one transaction:
    /// whoever sent a message has read everything before it, and nobody is
    /// told about a message that was not stored.
    /// </summary>
    private static async Task<(ChannelReadDto Read, IReadOnlyList<UserNotification> Mentions)> StoreAsync(
        AppDbContext db,
        Guid serverId,
        Message message,
        CancellationToken cancellationToken)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        db.Messages.Add(message);
        await db.SaveChangesAsync(cancellationToken);
        var read = await ChannelReadEndpoints.AdvanceAsync(
            db, message.ChannelId, message.AuthorId, message.CreatedAt, cancellationToken);
        var mentions = await MessageMentions.AddNotificationsAsync(db, serverId, message, cancellationToken);
        if (mentions.Count > 0)
        {
            await db.SaveChangesAsync(cancellationToken);
        }

        await transaction.CommitAsync(cancellationToken);
        return (read, mentions);
    }

    /// <summary>
    /// Rewrites a message. Only its author may: removing what somebody said
    /// is one act, putting new words under their name is another. Anyone else,
    /// moderators included, and any server notice, is answered with 404, so
    /// that probing cannot tell which ids exist.
    /// </summary>
    private static async Task<IResult> EditAsync(
        Guid messageId,
        EditMessageRequest request,
        HttpContext http,
        AppDbContext db,
        IHubContext<AppHub> hub,
        CancellationToken cancellationToken)
    {
        var content = request.Content?.Trim() ?? "";
        if (content.Length == 0 || content.Length > MessageLimits.MaxContentLength)
        {
            return Invalid(
                "content",
                $"Wiadomość musi zawierać tekst i mieć najwyżej {MessageLimits.MaxContentLength} znaków.");
        }

        var serverId = http.RequireActiveServerId();
        var userId = http.User.RequireUserId();
        var message = await OnServer(db, messageId, serverId)
            .WithMessageDetails()
            .AsSplitQuery()
            .FirstOrDefaultAsync(cancellationToken);
        if (message is null || message.IsSystem || message.AuthorId != userId)
        {
            return Results.NotFound();
        }

        // Saving the same text twice is not an edit, and "edited" is a claim
        // readers rely on.
        if (!string.Equals(message.Content, content, StringComparison.Ordinal))
        {
            message.Content = content;
            message.EditedAt = DateTime.UtcNow;
            await db.SaveChangesAsync(cancellationToken);
        }

        // The event is shared by everyone, so it cannot say which reactions
        // are the viewer's own; clients keep that from history.
        await hub.Clients.Group(AppHub.ServerGroup(serverId))
            .SendAsync("MessageUpdated", message.ToDto(), CancellationToken.None);

        return Results.Ok(message.ToDto(userId));
    }

    /// <summary>
    /// Removes a message. Its author may, and so may whoever can manage
    /// messages in that channel; everyone else is answered with 404.
    /// </summary>
    private static async Task<IResult> DeleteAsync(
        Guid messageId,
        HttpContext http,
        AppDbContext db,
        IHubContext<AppHub> hub,
        EmbedBuilder embedBuilder,
        CancellationToken cancellationToken)
    {
        var serverId = http.RequireActiveServerId();
        var userId = http.User.RequireUserId();
        var message = await OnServer(db, messageId, serverId).SingleOrDefaultAsync(cancellationToken);
        if (message is null || message.IsSystem)
        {
            return Results.NotFound();
        }

        if (message.AuthorId != userId &&
            !await ServerAccess.HasAsync(
                db, userId, serverId, message.ChannelId, ServerPrivileges.ManageMessages, cancellationToken))
        {
            return Results.NotFound();
        }

        // The attachment links go with the message; the stored files stay,
        // because another message may use them. The preview images belong to
        // the message's embeds alone, so they are removed with it.
        await embedBuilder.ClearAsync(messageId, cancellationToken);
        db.Messages.Remove(message);
        await db.SaveChangesAsync(cancellationToken);

        await hub.Clients.Group(AppHub.ServerGroup(serverId))
            .SendAsync(
                "MessageDeleted",
                new MessageDeletedDto(messageId.ToString(), message.ChannelId.ToString()),
                CancellationToken.None);
        return Results.NoContent();
    }

    private static IQueryable<Message> OnServer(AppDbContext db, Guid messageId, Guid serverId) =>
        db.Messages.Where(x => x.Id == messageId &&
            db.Channels.Any(channel => channel.Id == x.ChannelId && channel.ServerId == serverId));

    private static IResult Invalid(string field, string message) =>
        Results.ValidationProblem(new Dictionary<string, string[]> { [field] = [message] });
}
