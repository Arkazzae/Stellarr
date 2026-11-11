using Stellarr.Api.Domain;
using Stellarr.Api.Secrets;

namespace Stellarr.Api.Mail;

public enum MailProvider
{
    Smtp,
    Resend,
}

/// <summary>How a connection to the SMTP server is secured.</summary>
public enum SmtpSecurity
{
    /// <summary>Plain connection, upgraded with STARTTLS; the usual port is 587.</summary>
    StartTls,

    /// <summary>TLS from the first byte; the usual port is 465.</summary>
    Tls,

    /// <summary>No encryption at all, for a relay on the same host or network.</summary>
    None,
}

public sealed record SmtpConnection(string Host, int Port, SmtpSecurity Security, string Username, string Password)
{
    // A record prints its members; this one must never print the password.
    public override string ToString() => $"SmtpConnection {{ Host = {Host}, Port = {Port}, Security = {Security} }}";
}

/// <summary>
/// What outgoing mail goes through. <c>Ready</c> is false while the chosen
/// provider lacks what it needs: an SMTP host, or the Resend key.
/// <c>ResendApiKey</c> is empty unless the provider is Resend.
/// </summary>
public sealed record MailTransport(MailProvider Provider, SmtpConnection? Smtp, bool Ready, string ResendApiKey = "")
{
    // A record prints its members; this one must never print a secret.
    public override string ToString() => $"MailTransport {{ Provider = {Provider}, Smtp = {Smtp}, Ready = {Ready} }}";
}

public static class MailTransports
{
    public const string StartTlsName = "starttls";
    public const string TlsName = "tls";
    public const string NoneName = "none";

    public static readonly string[] SecurityNames = [StartTlsName, TlsName, NoneName];

    /// <summary>The transport for <paramref name="settings"/> with the secrets as Cockpit resolves them.</summary>
    public static MailTransport Resolve(OperationsSettings? settings, ResolvedSecrets secrets) =>
        Resolve(settings, secrets.ResendApiKey.Value, secrets.SmtpPassword.Value);

    /// <summary>
    /// SMTP is the main transport; Resend replaces it when the operator turns it
    /// on. An installation that never chose (the flag is null) keeps sending
    /// through Resend when it has a Resend key and no SMTP host, as it did before
    /// SMTP existed.
    /// </summary>
    public static MailTransport Resolve(OperationsSettings? settings, string resendApiKey, string smtpPassword)
    {
        var host = settings?.MailSmtpHost.Trim() ?? "";
        var resendKey = !string.IsNullOrWhiteSpace(resendApiKey);
        var provider = settings?.MailResendEnabled switch
        {
            true => MailProvider.Resend,
            false => MailProvider.Smtp,
            null => resendKey && host.Length == 0 ? MailProvider.Resend : MailProvider.Smtp,
        };

        if (provider == MailProvider.Resend)
        {
            return new MailTransport(MailProvider.Resend, null, resendKey, resendApiKey.Trim());
        }

        var smtp = new SmtpConnection(
            host,
            settings?.MailSmtpPort ?? OperationsSettings.DefaultSmtpPort,
            ParseSecurity(settings?.MailSmtpSecurity),
            settings?.MailSmtpUsername.Trim() ?? "",
            smtpPassword);
        return new MailTransport(MailProvider.Smtp, smtp, host.Length > 0);
    }

    public static string NameOf(MailProvider provider) => provider == MailProvider.Resend ? "resend" : "smtp";

    public static SmtpSecurity ParseSecurity(string? name) => name?.Trim().ToLowerInvariant() switch
    {
        TlsName => SmtpSecurity.Tls,
        NoneName => SmtpSecurity.None,
        _ => SmtpSecurity.StartTls,
    };
}
