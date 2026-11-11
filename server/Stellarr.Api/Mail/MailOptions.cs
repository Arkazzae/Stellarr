namespace Stellarr.Api.Mail;

/// <summary>
/// Configuration of outgoing mail from the environment. The secrets, the Resend
/// key (<c>Mail:ResendApiKey</c>) and the SMTP password (<c>Mail:SmtpPassword</c>),
/// are read through <see cref="Secrets.InstanceSecrets"/>, which prefers what the
/// operator set in Cockpit; the SMTP server and the choice of provider are the
/// operator's settings in the database.
/// </summary>
public sealed class MailOptions
{
    public const string SectionName = "Mail";

    public string FromAddress { get; set; } = "";
    public string FromName { get; set; } = "Stellarr";
}
