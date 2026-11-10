using System.Globalization;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Auth;
using Stellarr.Api.Contracts;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;
using Stellarr.Api.Messaging;
using Stellarr.Api.Realtime;

namespace Stellarr.Api.Endpoints;

/// <summary>Posting to a text channel.</summary>
public static class MessageEndpoints
{
    private const int MaxAttachments = 10;

    public static IEndpointRouteBuilder MapMessageEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var api = endpoints.MapGroup("/api")
            .RequireAuthorization()
            .AddEndpointFilter<ServerMembershipFilter>();
        api.MapPost("/channels/{channelId:guid}/messages", CreateAsync);
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
                read = await StoreAsync(db, message, cancellationToken);
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
    /// Stores the message and moves its author's read marker to it in one
    /// transaction: whoever sent a message has read everything before it.
    /// </summary>
    private static async Task<ChannelReadDto> StoreAsync(
        AppDbContext db,
        Message message,
        CancellationToken cancellationToken)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        db.Messages.Add(message);
        await db.SaveChangesAsync(cancellationToken);
        var read = await ChannelReadEndpoints.AdvanceAsync(
            db, message.ChannelId, message.AuthorId, message.CreatedAt, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return read;
    }

    private static IResult Invalid(string field, string message) =>
        Results.ValidationProblem(new Dictionary<string, string[]> { [field] = [message] });
}
