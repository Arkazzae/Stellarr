using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Text;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Stellarr.Api.Embeds;

namespace Stellarr.Api.Tests;

/// <summary>
/// The unfurler against a real socket on this machine, which is a private
/// address and so shows both what the connection guard refuses and what
/// the operator can allow.
/// </summary>
public sealed class LinkUnfurlerConnectionTests
{
    [Theory]
    [InlineData("http://127.0.0.1:9/")]
    [InlineData("http://localhost:9/")]
    [InlineData("http://[::1]:9/")]
    public async Task RefusesToConnectToAPrivateAddress(string url)
    {
        using var invoker = new HttpMessageInvoker(LinkUnfurler.CreateHandler(new EmbedOptions()));

        // The refusal comes before any connection, so nothing needs to listen.
        await Assert.ThrowsAsync<HttpRequestException>(
            () => invoker.SendAsync(new HttpRequestMessage(HttpMethod.Get, url), CancellationToken.None));
    }

    [Fact]
    public async Task ReadsAPrivateHostOnlyWhenTheOperatorAllowsIt()
    {
        using var server = new PageServer(Page("text/html; charset=utf-8", Encoding.UTF8.GetBytes(
            "<html><head><title>Local &amp; private</title></head></html>")));

        Assert.Null(await CreateUnfurler(allowPrivate: false).FetchCardAsync(server.Address, CancellationToken.None));
        var card = await CreateUnfurler(allowPrivate: true).FetchCardAsync(server.Address, CancellationToken.None);
        Assert.Equal("Local & private", card?.Title);
    }

    [Fact]
    public async Task DecodesPagesInTheCharsetTheyDeclare()
    {
        using var server = new PageServer(Page("text/html; charset=iso-8859-1", Encoding.Latin1.GetBytes(
            "<html><head><title>Café Ünïcode</title></head></html>")));

        var card = await CreateUnfurler(allowPrivate: true).FetchCardAsync(server.Address, CancellationToken.None);

        Assert.Equal("Café Ünïcode", card?.Title);
    }

    [Fact]
    public async Task GivesUpOnAHostThatNeverAnswers()
    {
        using var server = new PageServer((_, stopped) => Task.Delay(Timeout.Infinite, stopped));
        var clock = Stopwatch.StartNew();

        var card = await CreateUnfurler(allowPrivate: true, timeoutSeconds: 1)
            .FetchCardAsync(server.Address, CancellationToken.None);

        Assert.Null(card);
        Assert.True(clock.Elapsed < TimeSpan.FromSeconds(8), $"took {clock.Elapsed}");
    }

    [Fact]
    public async Task ReadsNoPageThatAnnouncesMoreThanTheCap()
    {
        using var server = new PageServer(Page("text/html", Encoding.UTF8.GetBytes(
            "<html><head><title>Large</title></head>" + new string(' ', 2048) + "</html>")));

        Assert.Null(await CreateUnfurler(allowPrivate: true, maxHtmlBytes: 1024)
            .FetchCardAsync(server.Address, CancellationToken.None));
    }

    [Fact]
    public async Task ReadsAStreamedPageOnlyAsFarAsTheCap()
    {
        using var server = new PageServer(StreamedPage("text/html", Encoding.UTF8.GetBytes(
            "<html><head><meta property=\"og:title\" content=\"Streamed\">" +
            new string(' ', 2048) +
            "<meta property=\"og:description\" content=\"Past the cap\"></head></html>")));

        var card = await CreateUnfurler(allowPrivate: true, maxHtmlBytes: 1024)
            .FetchCardAsync(server.Address, CancellationToken.None);

        Assert.Equal("Streamed", card?.Title);
        Assert.Null(card?.Description);
    }

    [Fact]
    public async Task KeepsAnImageOnlyWhenItsBytesAreWhatItsHeaderSays()
    {
        using var genuine = new PageServer(Page("image/png", FakeUnfurler.Png));
        using var disguised = new PageServer(Page("image/png", "<script>alert(1)</script>"u8.ToArray()));
        var unfurler = CreateUnfurler(allowPrivate: true);

        var image = await unfurler.FetchImageAsync(genuine.Address, CancellationToken.None);
        Assert.Equal(FakeUnfurler.Png, image?.Bytes);
        Assert.Equal("image/png", image?.ContentType);
        Assert.EndsWith(".png", image?.FileName);
        Assert.Null(await unfurler.FetchImageAsync(disguised.Address, CancellationToken.None));
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task DropsAnImageOverTheCapInsteadOfStoringItCutShort(bool announced)
    {
        var oversized = FakeUnfurler.Png.Concat(new byte[4096]).ToArray();
        using var server = new PageServer(announced ? Page("image/png", oversized) : StreamedPage("image/png", oversized));

        Assert.Null(await CreateUnfurler(allowPrivate: true, maxImageBytes: 1024)
            .FetchImageAsync(server.Address, CancellationToken.None));
    }

    private static LinkUnfurler CreateUnfurler(
        bool allowPrivate,
        int timeoutSeconds = 6,
        int maxHtmlBytes = 512 * 1024,
        int maxImageBytes = 1024 * 1024)
    {
        var options = new EmbedOptions
        {
            AllowPrivateNetworks = allowPrivate,
            TimeoutSeconds = timeoutSeconds,
            MaxHtmlBytes = maxHtmlBytes,
            MaxImageBytes = maxImageBytes,
        };
        return new LinkUnfurler(
            new HttpClient(LinkUnfurler.CreateHandler(options)),
            Options.Create(options),
            NullLogger<LinkUnfurler>.Instance);
    }

    private static Func<NetworkStream, CancellationToken, Task> Page(string contentType, byte[] body) =>
        async (stream, stopped) =>
        {
            var head = $"HTTP/1.1 200 OK\r\nContent-Type: {contentType}\r\nContent-Length: {body.Length}\r\nConnection: close\r\n\r\n";
            await stream.WriteAsync(Encoding.ASCII.GetBytes(head), stopped);
            await stream.WriteAsync(body, stopped);
        };

    /// <summary>A body that ends when the connection does, so that its size is not announced.</summary>
    private static Func<NetworkStream, CancellationToken, Task> StreamedPage(string contentType, byte[] body) =>
        async (stream, stopped) =>
        {
            var head = $"HTTP/1.1 200 OK\r\nContent-Type: {contentType}\r\nConnection: close\r\n\r\n";
            await stream.WriteAsync(Encoding.ASCII.GetBytes(head), stopped);
            await stream.WriteAsync(body, stopped);
        };

    /// <summary>Answers every request on a loopback port with whatever <c>respond</c> writes.</summary>
    private sealed class PageServer : IDisposable
    {
        private readonly TcpListener _listener = new(IPAddress.Loopback, 0);
        private readonly CancellationTokenSource _stopped = new();

        internal PageServer(Func<NetworkStream, CancellationToken, Task> respond)
        {
            _listener.Start();
            _ = Task.Run(async () =>
            {
                while (!_stopped.IsCancellationRequested)
                {
                    var client = await _listener.AcceptTcpClientAsync(_stopped.Token);
                    _ = Task.Run(async () =>
                    {
                        using (client)
                        {
                            var stream = client.GetStream();
                            await stream.ReadAtLeastAsync(new byte[4096], 1, throwOnEndOfStream: false, _stopped.Token);
                            await respond(stream, _stopped.Token);
                        }
                    });
                }
            }).ContinueWith(_ => { }, TaskScheduler.Default);
        }

        internal Uri Address => new($"http://127.0.0.1:{((IPEndPoint)_listener.LocalEndpoint).Port}/");

        public void Dispose()
        {
            _stopped.Cancel();
            _listener.Stop();
            _stopped.Dispose();
        }
    }
}
