using System.Net;
using Stellarr.Api.Localization;

namespace Stellarr.Api.Mail;

/// <summary>The messages the instance sends about an account or about itself.</summary>
public static class AccountEmail
{
    /// <param name="messages">The catalog of the instance.</param>
    public static EmailMessage PasswordReset(
        string from,
        string to,
        string displayName,
        string instanceName,
        string resetUrl,
        Guid tokenId,
        Messages messages)
    {
        var name = WebUtility.HtmlEncode(displayName);
        var instance = WebUtility.HtmlEncode(instanceName);
        var link = WebUtility.HtmlEncode(resetUrl);
        var text = string.Join(
            "\n",
            messages.Get(MessageKey.PasswordResetGreeting, ("name", displayName)),
            "",
            messages.Get(MessageKey.PasswordResetInstruction, ("instance", instanceName)),
            resetUrl,
            "",
            messages.Get(MessageKey.PasswordResetValidity));
        var html = $$"""
            <!doctype html>
            <html lang="{{messages.Language}}"><body style="margin:0;background:#171717;color:#f5f5f5;font-family:system-ui,-apple-system,Segoe UI,sans-serif">
              <div style="max-width:560px;margin:0 auto;padding:40px 24px">
                <p style="margin:0 0 24px;color:#d6a554;font-weight:700">{{instance}}</p>
                <h1 style="margin:0 0 16px;font-size:26px;line-height:1.25">{{messages.Get(MessageKey.PasswordResetHeading)}}</h1>
                <p style="margin:0 0 24px;color:#d4d4d4;line-height:1.6">{{messages.Get(MessageKey.PasswordResetIntro, ("name", name))}}</p>
                <p style="margin:0 0 28px"><a href="{{link}}" style="display:inline-block;padding:12px 18px;background:#d6a554;color:#17130d;text-decoration:none;font-weight:700;border-radius:4px">{{messages.Get(MessageKey.PasswordResetButton)}}</a></p>
                <p style="margin:0;color:#a3a3a3;font-size:13px;line-height:1.6">{{messages.Get(MessageKey.PasswordResetIgnore)}}</p>
              </div>
            </body></html>
            """;

        return new EmailMessage(
            from,
            to,
            messages.Get(MessageKey.PasswordResetSubject, ("instance", instanceName)),
            html,
            text,
            $"password-reset/{tokenId:N}");
    }

    /// <summary>What the operator panel sends to check that the provider accepts mail.</summary>
    public static EmailMessage DeliveryTest(string from, string to, string instanceName, Messages messages)
    {
        var instance = WebUtility.HtmlEncode(instanceName);
        return new EmailMessage(
            from,
            to,
            messages.Get(MessageKey.DeliveryTestSubject, ("instance", instanceName)),
            $"<p>{messages.Get(MessageKey.DeliveryTestBody, ("instance", $"<strong>{instance}</strong>"))}</p>",
            messages.Get(MessageKey.DeliveryTestBody, ("instance", instanceName)),
            $"delivery-test/{Guid.NewGuid():N}");
    }

    public static EmailMessage EmailCode(
        string from,
        string to,
        string displayName,
        string instanceName,
        string code,
        Guid codeId,
        Messages messages)
    {
        var name = WebUtility.HtmlEncode(displayName);
        var instance = WebUtility.HtmlEncode(instanceName);
        var text = string.Join(
            "\n",
            messages.Get(MessageKey.PasswordResetGreeting, ("name", displayName)),
            "",
            messages.Get(MessageKey.SecurityEmailCodeSent, ("email", "your address")),
            code,
            "",
            messages.Get(MessageKey.SecurityAlertIgnore));
        var html = $$"""
            <!doctype html>
            <html lang="{{messages.Language}}"><body style="margin:0;background:#171717;color:#f5f5f5;font-family:system-ui,-apple-system,Segoe UI,sans-serif">
              <div style="max-width:560px;margin:0 auto;padding:40px 24px">
                <p style="margin:0 0 24px;color:#d6a554;font-weight:700">{{instance}}</p>
                <h1 style="margin:0 0 16px;font-size:26px;line-height:1.25">{{messages.Get(MessageKey.SecurityAlertSubject, ("instance", instanceName))}}</h1>
                <p style="margin:0 0 20px;color:#d4d4d4;line-height:1.6">{{messages.Get(MessageKey.SecurityAlertGreeting, ("name", name))}}</p>
                <p style="margin:0 0 24px;font-size:32px;letter-spacing:.18em;font-weight:700">{{WebUtility.HtmlEncode(code)}}</p>
                <p style="margin:0;color:#a3a3a3;font-size:13px;line-height:1.6">{{messages.Get(MessageKey.SecurityAlertIgnore)}}</p>
              </div>
            </body></html>
            """;
        return new EmailMessage(
            from,
            to,
            messages.Get(MessageKey.SecurityAlertSubject, ("instance", instanceName)),
            html,
            text,
            $"email-code/{codeId:N}");
    }

    public static EmailMessage SecurityAlert(
        string from,
        string to,
        string displayName,
        string instanceName,
        string activity,
        DateTime occurredAt,
        Guid eventId,
        Messages messages)
    {
        var name = WebUtility.HtmlEncode(displayName);
        var instance = WebUtility.HtmlEncode(instanceName);
        var safeActivity = WebUtility.HtmlEncode(activity);
        var time = WebUtility.HtmlEncode(occurredAt.ToString("u", System.Globalization.CultureInfo.InvariantCulture));
        var text = string.Join(
            "\n",
            messages.Get(MessageKey.SecurityAlertGreeting, ("name", displayName)),
            "",
            messages.Get(MessageKey.SecurityAlertInstruction, ("time", occurredAt.ToString("u", System.Globalization.CultureInfo.InvariantCulture)), ("activity", activity)),
            "",
            messages.Get(MessageKey.SecurityAlertIgnore));
        var html = $$"""
            <!doctype html>
            <html lang="{{messages.Language}}"><body style="margin:0;background:#171717;color:#f5f5f5;font-family:system-ui,-apple-system,Segoe UI,sans-serif">
              <div style="max-width:560px;margin:0 auto;padding:40px 24px">
                <p style="margin:0 0 24px;color:#d6a554;font-weight:700">{{instance}}</p>
                <h1 style="margin:0 0 16px;font-size:26px;line-height:1.25">{{messages.Get(MessageKey.SecurityAlertSubject, ("instance", instanceName))}}</h1>
                <p style="margin:0 0 16px;color:#d4d4d4;line-height:1.6">{{messages.Get(MessageKey.SecurityAlertGreeting, ("name", name))}}</p>
                <p style="margin:0 0 24px;color:#d4d4d4;line-height:1.6">{{safeActivity}}</p>
                <p style="margin:0;color:#a3a3a3;font-size:13px;line-height:1.6">{{time}}<br>{{messages.Get(MessageKey.SecurityAlertIgnore)}}</p>
              </div>
            </body></html>
            """;
        return new EmailMessage(
            from,
            to,
            messages.Get(MessageKey.SecurityAlertSubject, ("instance", instanceName)),
            html,
            text,
            $"security-event/{eventId:N}");
    }
}
