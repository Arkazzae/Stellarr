namespace Stellarr.Api.Mail;

/// <summary>A message the chosen provider could not take; the message says why.</summary>
public sealed class MailDeliveryException : Exception
{
    public MailDeliveryException()
    {
    }

    public MailDeliveryException(string message)
        : base(message)
    {
    }

    public MailDeliveryException(string message, Exception innerException)
        : base(message, innerException)
    {
    }
}

/// <summary>Hands each message to the provider its transport names.</summary>
public sealed class MailDelivery(ResendEmailDelivery resend, SmtpEmailDelivery smtp) : IEmailDelivery
{
    public Task<string> SendAsync(EmailMessage message, MailTransport transport, CancellationToken cancellationToken) =>
        transport.Provider == MailProvider.Resend
            ? resend.SendAsync(message, transport.ResendApiKey, cancellationToken)
            : smtp.SendAsync(
                message,
                transport.Smtp ?? throw new InvalidOperationException("An SMTP transport carries its connection."),
                cancellationToken);
}
