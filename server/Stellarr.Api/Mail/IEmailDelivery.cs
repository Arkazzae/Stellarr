namespace Stellarr.Api.Mail;

public sealed record EmailMessage(
    string From,
    string To,
    string Subject,
    string Html,
    string Text,
    string IdempotencyKey);

public interface IEmailDelivery
{
    /// <summary>Sends the message through <paramref name="transport"/> and returns the provider's id for it.</summary>
    Task<string> SendAsync(EmailMessage message, MailTransport transport, CancellationToken cancellationToken);
}
