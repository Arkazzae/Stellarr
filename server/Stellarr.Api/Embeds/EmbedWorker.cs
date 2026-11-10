using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Contracts;
using Stellarr.Api.Data;
using Stellarr.Api.Logging;
using Stellarr.Api.Realtime;

namespace Stellarr.Api.Embeds;

/// <summary>
/// Drains <see cref="EmbedInbox"/>: builds the embeds of each message and tells
/// the server's members when they are ready.
/// </summary>
/// <remarks>
/// One message at a time, on purpose. Unfurling is outbound traffic to hosts
/// we do not control, and a server that fans out on every posted link can be
/// aimed at somebody as a load generator. The message is on screen the moment
/// it is sent, and its cards arrive underneath a moment later.
/// </remarks>
public sealed class EmbedWorker(
    EmbedInbox inbox,
    IServiceScopeFactory scopes,
    IHubContext<AppHub> hub,
    ILogger<EmbedWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            await foreach (var request in inbox.ReadAllAsync(stoppingToken))
            {
                try
                {
                    await ProcessAsync(request, stoppingToken);
                }
                catch (Exception exception) when (exception is not OperationCanceledException || !stoppingToken.IsCancellationRequested)
                {
                    // One bad link must not take the worker down, or every
                    // later message would silently lose its previews.
                    EmbedLog.MessageFailed(logger, exception, request.MessageId);
                }
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            // The host is stopping.
        }
    }

    private async Task ProcessAsync(EmbedRequest request, CancellationToken cancellationToken)
    {
        await using var scope = scopes.CreateAsyncScope();
        var embeds = await scope.ServiceProvider.GetRequiredService<EmbedBuilder>()
            .BuildAsync(request.MessageId, cancellationToken);

        var serverId = await scope.ServiceProvider.GetRequiredService<AppDbContext>().Channels.AsNoTracking()
            .Where(x => x.Id == request.ChannelId)
            .Select(x => (Guid?)x.ServerId)
            .SingleOrDefaultAsync(cancellationToken);
        if (serverId is null)
        {
            return;
        }

        // Sent even when nothing was built: after an edit, an empty set is how
        // clients learn that the old cards are gone.
        var update = new MessageEmbedsDto(
            request.MessageId.ToString(),
            request.ChannelId.ToString(),
            [.. embeds.Select(x => x.ToDto())]);
        await hub.Clients.Group(AppHub.ServerGroup(serverId.Value))
            .SendAsync("MessageEmbedsUpdated", update, cancellationToken);
    }
}
