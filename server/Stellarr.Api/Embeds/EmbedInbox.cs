using System.Threading.Channels;

namespace Stellarr.Api.Embeds;

/// <summary>A message whose links are waiting to be unfurled.</summary>
public sealed record EmbedRequest(Guid ChannelId, Guid MessageId);

/// <summary>
/// Hands messages from the request that stored them to the worker that reads
/// the pages they link to, so that no send waits for a foreign host.
/// </summary>
/// <remarks>
/// Bounded, and when full it forgets the oldest request: a preview is
/// decoration, so a flood may cost cards but never a send or the process's
/// memory. The queue lives in memory, so a restart forgets what was pending;
/// those messages stay without a card until they are edited.
/// </remarks>
public sealed class EmbedInbox
{
    private const int Capacity = 256;

    private readonly Channel<EmbedRequest> _requests = Channel.CreateBounded<EmbedRequest>(
        new BoundedChannelOptions(Capacity)
        {
            FullMode = BoundedChannelFullMode.DropOldest,
            SingleReader = true,
        });

    public void Enqueue(EmbedRequest request) => _requests.Writer.TryWrite(request);

    public IAsyncEnumerable<EmbedRequest> ReadAllAsync(CancellationToken cancellationToken) =>
        _requests.Reader.ReadAllAsync(cancellationToken);
}
