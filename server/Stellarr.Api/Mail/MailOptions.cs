namespace Stellarr.Api.Mail;

/// <summary>
/// Configuration of outgoing mail. The provider's key is an environment secret;
/// the operator's settings in the database may override the sender address.
/// </summary>
public sealed class MailOptions
{
    public const string SectionName = "Mail";

    public string ResendApiKey { get; set; } = "";
    public string FromAddress { get; set; } = "";
    public string FromName { get; set; } = "Stellarr";
}
