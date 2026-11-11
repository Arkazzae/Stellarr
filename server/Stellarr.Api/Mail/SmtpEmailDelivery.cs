using MailKit;
using MailKit.Net.Smtp;
using MailKit.Security;
using MimeKit;

namespace Stellarr.Api.Mail;

/// <summary>Sends mail through an SMTP server with MailKit.</summary>
public sealed class SmtpEmailDelivery
{
    /// <summary>
    /// The whole exchange, from connecting to the server's last reply. Password
    /// recovery waits on it, so a server that hangs must not hold the request.
    /// </summary>
    public static readonly TimeSpan DefaultTimeout = TimeSpan.FromSeconds(15);

    private readonly TimeSpan _timeout;

    public SmtpEmailDelivery()
        : this(DefaultTimeout)
    {
    }

    internal SmtpEmailDelivery(TimeSpan timeout) => _timeout = timeout;

    /// <exception cref="MailDeliveryException">The server could not be reached, refused the login or the message, or did not answer in time.</exception>
    public async Task<string> SendAsync(EmailMessage message, SmtpConnection connection, CancellationToken cancellationToken)
    {
        var mime = new MimeMessage();
        mime.From.Add(MailboxAddress.Parse(message.From));
        mime.To.Add(MailboxAddress.Parse(message.To));
        mime.Subject = message.Subject;
        mime.MessageId = $"{message.IdempotencyKey}@stellarr";
        mime.Body = new BodyBuilder { HtmlBody = message.Html, TextBody = message.Text }.ToMessageBody();

        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        deadline.CancelAfter(_timeout);
        using var client = new SmtpClient { Timeout = (int)_timeout.TotalMilliseconds };
        try
        {
            await client.ConnectAsync(connection.Host, connection.Port, OptionsOf(connection.Security), deadline.Token);
            if (connection.Username.Length > 0)
            {
                await client.AuthenticateAsync(connection.Username, connection.Password, deadline.Token);
            }

            await client.SendAsync(mime, deadline.Token);
            await client.DisconnectAsync(quit: true, deadline.Token);
            return mime.MessageId;
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            throw new MailDeliveryException(
                $"The SMTP server {connection.Host}:{connection.Port} did not answer within {_timeout.TotalSeconds:0.#} seconds.");
        }
        catch (Exception exception) when (exception is SmtpCommandException or SmtpProtocolException
            or AuthenticationException or SslHandshakeException or ServiceNotConnectedException
            or IOException or System.Net.Sockets.SocketException or TimeoutException)
        {
            throw new MailDeliveryException($"SMTP {connection.Host}:{connection.Port}: {exception.Message}", exception);
        }
    }

    private static SecureSocketOptions OptionsOf(SmtpSecurity security) => security switch
    {
        SmtpSecurity.Tls => SecureSocketOptions.SslOnConnect,
        SmtpSecurity.None => SecureSocketOptions.None,
        _ => SecureSocketOptions.StartTls,
    };
}
