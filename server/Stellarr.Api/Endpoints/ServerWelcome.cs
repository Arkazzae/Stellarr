using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Contracts;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;
using Stellarr.Api.Localization;
using Stellarr.Api.Realtime;

namespace Stellarr.Api.Endpoints;

/// <summary>The system notice that greets a person who has just joined a server.</summary>
internal static class ServerWelcome
{
    /// <summary>
    /// Stages the notice in the server's first text channel; the caller saves
    /// it together with the membership. A server without a text channel gets
    /// no notice, which is valid for a voice-only server.
    /// </summary>
    internal static async Task<Message?> CreateAsync(
        AppDbContext db,
        Guid serverId,
        User user,
        DateTime joinedAt,
        Messages messages,
        CancellationToken cancellationToken)
    {
        if (await FirstTextChannelIdAsync(db, serverId, cancellationToken) is not { } channelId)
        {
            return null;
        }

        // The notice is markup, so a name cannot be allowed to open a tag of its own.
        var name = user.DisplayName.Replace("<", "‹", StringComparison.Ordinal).Replace(">", "›", StringComparison.Ordinal);
        var message = new Message
        {
            Id = Guid.NewGuid(),
            ChannelId = channelId,
            AuthorId = user.Id,
            Author = user,
            IsSystem = true,
            Content = messages.Get(MessageKey.ServerWelcomeNotice, ("name", name)),
            CreatedAt = joinedAt,
        };
        db.Messages.Add(message);
        return message;
    }

    /// <summary>Tells the members who are online, once the notice has been saved.</summary>
    internal static Task PublishAsync(
        IHubContext<AppHub> hub,
        Guid serverId,
        Message? message,
        Messages messages,
        CancellationToken cancellationToken) =>
        message is null
            ? Task.CompletedTask
            : hub.Clients.Group(AppHub.ServerGroup(serverId)).SendAsync("MessageCreated", message.ToDto(messages), cancellationToken);

    private static async Task<Guid?> FirstTextChannelIdAsync(
        AppDbContext db,
        Guid serverId,
        CancellationToken cancellationToken)
    {
        // A server created in the same unit of work has its channels staged, not saved.
        var staged = db.Channels.Local
            .Where(x => x.ServerId == serverId && x.Kind == ChannelKind.Text)
            .OrderBy(x => x.Position)
            .FirstOrDefault();
        if (staged is not null)
        {
            return staged.Id;
        }

        return await db.Channels.AsNoTracking()
            .Where(x => x.ServerId == serverId && x.Kind == ChannelKind.Text)
            .OrderBy(x => x.Position)
            .Select(x => (Guid?)x.Id)
            .FirstOrDefaultAsync(cancellationToken);
    }
}
