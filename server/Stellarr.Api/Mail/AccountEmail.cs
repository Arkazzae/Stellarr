using System.Net;

namespace Stellarr.Api.Mail;

/// <summary>The messages the instance sends about an account or about itself.</summary>
public static class AccountEmail
{
    public static EmailMessage PasswordReset(
        string from,
        string to,
        string displayName,
        string instanceName,
        string resetUrl,
        Guid tokenId)
    {
        var name = WebUtility.HtmlEncode(displayName);
        var instance = WebUtility.HtmlEncode(instanceName);
        var link = WebUtility.HtmlEncode(resetUrl);
        var text = $"""
            Cześć {displayName},

            Otwórz ten link, aby ustawić nowe hasło w {instanceName}:
            {resetUrl}

            Link wygasa za 60 minut i działa tylko raz. Jeśli to nie Ty, zignoruj tę wiadomość.
            """;
        var html = $$"""
            <!doctype html>
            <html lang="pl"><body style="margin:0;background:#171717;color:#f5f5f5;font-family:system-ui,-apple-system,Segoe UI,sans-serif">
              <div style="max-width:560px;margin:0 auto;padding:40px 24px">
                <p style="margin:0 0 24px;color:#d6a554;font-weight:700">{{instance}}</p>
                <h1 style="margin:0 0 16px;font-size:26px;line-height:1.25">Ustaw nowe hasło</h1>
                <p style="margin:0 0 24px;color:#d4d4d4;line-height:1.6">Cześć {{name}}. Otrzymaliśmy prośbę o zmianę hasła. Link wygasa za 60 minut i działa tylko raz.</p>
                <p style="margin:0 0 28px"><a href="{{link}}" style="display:inline-block;padding:12px 18px;background:#d6a554;color:#17130d;text-decoration:none;font-weight:700;border-radius:4px">Ustaw nowe hasło</a></p>
                <p style="margin:0;color:#a3a3a3;font-size:13px;line-height:1.6">Jeśli to nie Ty, zignoruj tę wiadomość. Twoje obecne hasło pozostanie bez zmian.</p>
              </div>
            </body></html>
            """;

        return new EmailMessage(from, to, $"Zmień hasło w {instanceName}", html, text, $"password-reset/{tokenId:N}");
    }

    /// <summary>What the operator panel sends to check that the provider accepts mail.</summary>
    public static EmailMessage DeliveryTest(string from, string to, string instanceName)
    {
        var instance = WebUtility.HtmlEncode(instanceName);
        return new EmailMessage(
            from,
            to,
            $"Test poczty z {instanceName}",
            $"<p>Resend poprawnie przyjął wiadomość testową z <strong>{instance}</strong>.</p>",
            $"Resend poprawnie przyjął wiadomość testową z {instanceName}.",
            $"delivery-test/{Guid.NewGuid():N}");
    }
}
