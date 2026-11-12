using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;
using Stellarr.Api.Mail;
using Stellarr.Api.Secrets;

namespace Stellarr.Api.Auth.Security;

public sealed record AccountMailing(string Sender, string PublicUrl, string InstanceName, MailTransport Transport);

public static class AccountMail
{
    public static async Task<AccountMailing?> FindAsync(
        AppDbContext db,
        IConfiguration configuration,
        MailOptions options,
        InstanceSecrets secrets,
        CancellationToken cancellationToken)
    {
        var server = await db.Servers.AsNoTracking()
            .OrderBy(x => x.CreatedAt).ThenBy(x => x.Id)
            .FirstOrDefaultAsync(cancellationToken);
        if (server is null)
        {
            return null;
        }

        var settings = await db.OperationsSettings.AsNoTracking()
            .SingleOrDefaultAsync(x => x.ServerId == server.Id, cancellationToken);
        var mailingEnabled = settings?.MailingEnabled ?? configuration.GetValue<bool>("Mail:Enabled");
        var fromAddress = FirstNotBlank(settings?.MailFromAddress, options.FromAddress);
        var publicUrl = (configuration["Operations:PublicUrl"] ?? "").Trim().TrimEnd('/');
        var transport = MailTransports.Resolve(settings, await secrets.ReadAsync(cancellationToken));
        if (!mailingEnabled || fromAddress.Length == 0 || publicUrl.Length == 0 || !transport.Ready)
        {
            return null;
        }

        var sender = string.IsNullOrWhiteSpace(options.FromName) ? fromAddress : $"{options.FromName.Trim()} <{fromAddress}>";
        return new AccountMailing(sender, publicUrl, server.Name, transport);
    }

    private static string FirstNotBlank(params string?[] values) =>
        values.FirstOrDefault(value => !string.IsNullOrWhiteSpace(value))?.Trim() ?? "";
}
