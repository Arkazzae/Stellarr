namespace Stellarr.Api.Mail;

/// <summary>
/// Configuration of outgoing mail. The secrets, the Resend key and the SMTP
/// password, live only here, in the environment; the SMTP server and the
/// choice of provider are the operator's settings in the database.
/// </summary>
public sealed class MailOptions
{
    public const string SectionName = "Mail";

    public string ResendApiKey { get; set; } = "";
    public string SmtpPassword { get; set; } = "";
    public string FromAddress { get; set; } = "";
    public string FromName { get; set; } = "Stellarr";
}
