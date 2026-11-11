using System.Net;
using System.Net.Sockets;
using System.Text;
using Stellarr.Api.Domain;
using Stellarr.Api.Mail;

namespace Stellarr.Api.Tests;

public sealed class SmtpDeliveryTests
{
    private static readonly EmailMessage Message = new(
        "Stellarr <sender@example.net>",
        "person@example.net",
        "Test from Orbit",
        "<p>Hello</p>",
        "Hello",
        "msg-1");

    [Fact]
    public async Task TheMessageGoesToTheServerWithItsEnvelopeAndBody()
    {
        await using var server = new FakeSmtpServer();
        var delivery = new SmtpEmailDelivery(TimeSpan.FromSeconds(10));

        var id = await delivery.SendAsync(Message, Connection(server.Port), CancellationToken.None);

        await server.Finished;
        Assert.Equal("msg-1@stellarr", id);
        Assert.Contains("MAIL FROM:<sender@example.net>", server.Commands);
        Assert.Contains("RCPT TO:<person@example.net>", server.Commands);
        Assert.Contains("Subject: Test from Orbit", server.Data, StringComparison.Ordinal);
        Assert.Contains("Message-Id: <msg-1@stellarr>", server.Data, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("QUIT", server.Commands);
    }

    [Fact]
    public async Task ARefusedRecipientIsReportedWithTheServersReply()
    {
        await using var server = new FakeSmtpServer(recipientReply: "550 5.1.1 No such mailbox");
        var delivery = new SmtpEmailDelivery(TimeSpan.FromSeconds(10));

        var failure = await Assert.ThrowsAsync<MailDeliveryException>(
            () => delivery.SendAsync(Message, Connection(server.Port), CancellationToken.None));

        Assert.Contains("No such mailbox", failure.Message, StringComparison.Ordinal);
        Assert.Contains($"127.0.0.1:{server.Port}", failure.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task AServerThatNeverAnswersFailsWithinTheTimeout()
    {
        await using var server = new FakeSmtpServer(silent: true);
        var delivery = new SmtpEmailDelivery(TimeSpan.FromMilliseconds(500));

        var started = DateTime.UtcNow;
        await Assert.ThrowsAsync<MailDeliveryException>(
            () => delivery.SendAsync(Message, Connection(server.Port), CancellationToken.None));

        Assert.True(DateTime.UtcNow - started < TimeSpan.FromSeconds(5));
    }

    [Fact]
    public async Task NoServerListeningIsADeliveryFailure()
    {
        using var probe = new TcpListener(IPAddress.Loopback, 0);
        probe.Start();
        var port = ((IPEndPoint)probe.LocalEndpoint).Port;
        probe.Stop();

        await Assert.ThrowsAsync<MailDeliveryException>(
            () => new SmtpEmailDelivery(TimeSpan.FromSeconds(5)).SendAsync(Message, Connection(port), CancellationToken.None));
    }

    [Fact]
    public void SmtpIsTheMainTransport()
    {
        var withHost = new OperationsSettings { MailSmtpHost = " smtp.example.net ", MailSmtpPort = 465, MailSmtpSecurity = "tls", MailSmtpUsername = "mailer" };
        var transport = MailTransports.Resolve(withHost, resendApiKey: "re_x", smtpPassword: "secret");

        Assert.Equal((MailProvider.Smtp, true), (transport.Provider, transport.Ready));
        Assert.Equal(new SmtpConnection("smtp.example.net", 465, SmtpSecurity.Tls, "mailer", "secret"), transport.Smtp);
        Assert.False(MailTransports.Resolve(new OperationsSettings(), "", "").Ready);
        Assert.Equal(SmtpSecurity.StartTls, MailTransports.Resolve(new OperationsSettings { MailSmtpHost = "h" }, "", "").Smtp!.Security);
    }

    [Theory]
    [InlineData(null, "re_x", "", MailProvider.Resend, true)]
    [InlineData(null, "re_x", "smtp.example.net", MailProvider.Smtp, true)]
    [InlineData(null, "", "", MailProvider.Smtp, false)]
    [InlineData(false, "re_x", "", MailProvider.Smtp, false)]
    [InlineData(true, "", "smtp.example.net", MailProvider.Resend, false)]
    [InlineData(true, "re_x", "smtp.example.net", MailProvider.Resend, true)]
    public void ResendReplacesSmtpWhenChosenOrWhenItIsAllThereIs(
        bool? resendEnabled,
        string resendKey,
        string smtpHost,
        MailProvider provider,
        bool ready)
    {
        var transport = MailTransports.Resolve(
            new OperationsSettings { MailResendEnabled = resendEnabled, MailSmtpHost = smtpHost },
            resendKey,
            smtpPassword: "");

        Assert.Equal((provider, ready), (transport.Provider, transport.Ready));
    }

    private static SmtpConnection Connection(int port) => new("127.0.0.1", port, SmtpSecurity.None, "", "");

    /// <summary>
    /// A plain SMTP server for one connection: it answers each command, keeps
    /// the commands and the message, and can refuse the recipient or stay silent.
    /// </summary>
    private sealed class FakeSmtpServer : IAsyncDisposable
    {
        private readonly TcpListener _listener = new(IPAddress.Loopback, 0);
        private readonly CancellationTokenSource _stop = new();
        private readonly List<string> _commands = [];
        private readonly StringBuilder _data = new();

        public FakeSmtpServer(string recipientReply = "250 2.1.5 OK", bool silent = false)
        {
            _listener.Start();
            Finished = ServeAsync(recipientReply, silent, _stop.Token);
        }

        public int Port => ((IPEndPoint)_listener.LocalEndpoint).Port;

        public Task Finished { get; }

        public IReadOnlyList<string> Commands
        {
            get
            {
                lock (_commands) return _commands.ToArray();
            }
        }

        public string Data
        {
            get
            {
                lock (_data) return _data.ToString();
            }
        }

        public async ValueTask DisposeAsync()
        {
            await _stop.CancelAsync();
            _listener.Stop();
            try
            {
                await Finished;
            }
            catch (Exception exception) when (exception is OperationCanceledException or SocketException or IOException or ObjectDisposedException)
            {
            }

            _stop.Dispose();
        }

        private async Task ServeAsync(string recipientReply, bool silent, CancellationToken stop)
        {
            using var client = await _listener.AcceptTcpClientAsync(stop);
            await using var stream = client.GetStream();
            using var reader = new StreamReader(stream, Encoding.ASCII);
            await using var writer = new StreamWriter(stream, Encoding.ASCII) { NewLine = "\r\n", AutoFlush = true };
            if (silent)
            {
                await Task.Delay(Timeout.Infinite, stop);
                return;
            }

            await writer.WriteLineAsync("220 fake.test ESMTP");
            while (await reader.ReadLineAsync(stop) is { } line)
            {
                lock (_commands) _commands.Add(line);
                var verb = line.Split(' ')[0].ToUpperInvariant();
                if (verb == "EHLO")
                {
                    await writer.WriteLineAsync("250-fake.test");
                    await writer.WriteLineAsync("250 8BITMIME");
                }
                else if (verb == "RCPT")
                {
                    await writer.WriteLineAsync(recipientReply);
                }
                else if (verb == "DATA")
                {
                    await writer.WriteLineAsync("354 End data with <CR><LF>.<CR><LF>");
                    while (await reader.ReadLineAsync(stop) is { } body && body != ".")
                    {
                        lock (_data) _data.Append(body).Append('\n');
                    }

                    await writer.WriteLineAsync("250 2.0.0 Queued");
                }
                else if (verb == "QUIT")
                {
                    await writer.WriteLineAsync("221 2.0.0 Bye");
                    return;
                }
                else
                {
                    await writer.WriteLineAsync("250 OK");
                }
            }
        }
    }
}
