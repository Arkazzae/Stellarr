using System.Net;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Auth;
using Stellarr.Api.Contracts;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;
using Stellarr.Api.Localization;

namespace Stellarr.Api.Endpoints;

/// <summary>
/// Signs the desktop client in through the system browser, where the single
/// sign-on provider works. The client starts a request and keeps its secret,
/// the browser approves the request id, and the client then trades id and
/// secret for its own session. The browser never learns the secret and never
/// sees the session cookie.
/// </summary>
public static class DesktopBrowserLoginEndpoints
{
    private const int SecretBytes = 32;
    private const int HashLength = 64;
    private static readonly TimeSpan RequestLifetime = TimeSpan.FromMinutes(2);

    public static IEndpointRouteBuilder MapDesktopBrowserLoginEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var group = endpoints.MapGroup("/api/auth/desktop/browser");

        group.MapPost("/start", StartAsync).RequireRateLimiting(RateLimitPolicies.Login);
        group.MapGet("/verify/{requestId:guid}", ApproveAsync).RequireAuthorization();
        // Polled while the person signs in, so it has a budget apart from password attempts.
        group.MapPost("/exchange", ExchangeAsync).RequireRateLimiting(RateLimitPolicies.LoginPoll);

        return endpoints;
    }

    private static async Task<IResult> StartAsync(
        AppDbContext db,
        ExternalOidcOptions oidc,
        CancellationToken cancellationToken)
    {
        if (!oidc.IsConfigured)
        {
            return Results.NotFound();
        }

        var now = DateTime.UtcNow;
        await db.DesktopBrowserLogins.Where(x => x.ExpiresAt <= now).ExecuteDeleteAsync(cancellationToken);

        var secret = WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(SecretBytes));
        var login = new DesktopBrowserLogin
        {
            Id = Guid.NewGuid(),
            SecretHash = HashSecret(secret),
            CreatedAt = now,
            ExpiresAt = now + RequestLifetime,
        };
        db.DesktopBrowserLogins.Add(login);
        await db.SaveChangesAsync(cancellationToken);

        // The browser signs in with the provider first and lands on the approval.
        var approvalPath = $"/api/auth/desktop/browser/verify/{login.Id}";
        return Results.Ok(new
        {
            requestId = login.Id.ToString(),
            secret,
            verificationUrl = $"/api/auth/oidc/login?returnUrl={Uri.EscapeDataString(approvalPath)}",
            expiresAt = login.ExpiresAt,
        });
    }

    private static async Task<IResult> ApproveAsync(
        Guid requestId,
        Messages messages,
        HttpContext context,
        AppDbContext db,
        CancellationToken cancellationToken)
    {
        var userId = context.User.RequireUserId();
        var now = DateTime.UtcNow;
        var login = await db.DesktopBrowserLogins.SingleOrDefaultAsync(x => x.Id == requestId, cancellationToken);
        if (login is null || login.ExpiresAt <= now || login.RedeemedAt is not null)
        {
            return Page(
                context,
                messages,
                messages.Get(MessageKey.BrowserLoginExpiredHeading),
                messages.Get(MessageKey.BrowserLoginExpiredBody),
                StatusCodes.Status410Gone);
        }

        if (login.UserId is { } approvedBy && approvedBy != userId)
        {
            return Results.Conflict(new { title = messages.Get(MessageKey.BrowserLoginApprovedByAnother) });
        }

        login.UserId = userId;
        login.ApprovedAt ??= now;
        await db.SaveChangesAsync(cancellationToken);
        return Page(
            context,
            messages,
            messages.Get(MessageKey.BrowserLoginDoneHeading),
            messages.Get(MessageKey.BrowserLoginDoneBody));
    }

    private static async Task<IResult> ExchangeAsync(
        DesktopBrowserExchangeRequest request,
        Messages messages,
        HttpContext context,
        AppDbContext db,
        CancellationToken cancellationToken)
    {
        if (!Guid.TryParse(request.RequestId, out var requestId))
        {
            return RejectedLink(messages);
        }

        var now = DateTime.UtcNow;
        var login = await db.DesktopBrowserLogins.SingleOrDefaultAsync(x => x.Id == requestId, cancellationToken);
        if (login is null || login.ExpiresAt <= now || login.RedeemedAt is not null ||
            !SecretMatches(request.Secret ?? "", login.SecretHash))
        {
            return RejectedLink(messages);
        }

        if (login.UserId is not { } userId || login.ApprovedAt is null)
        {
            return Results.Accepted(value: new { status = "pending" });
        }

        // Redeeming is a conditional update, so two exchanges racing for the
        // same approval cannot both win.
        var redeemed = await db.DesktopBrowserLogins
            .Where(x => x.Id == requestId && x.RedeemedAt == null && x.ExpiresAt > now)
            .ExecuteUpdateAsync(setters => setters.SetProperty(x => x.RedeemedAt, now), cancellationToken);
        if (redeemed != 1)
        {
            return RejectedLink(messages);
        }

        var user = await db.Users.SingleOrDefaultAsync(x => x.Id == userId && !x.IsDisabled, cancellationToken);
        if (user is null)
        {
            return Results.Forbid();
        }

        var session = SessionAuthentication.CreateSession(context, user.Id);
        db.UserSessions.Add(session);
        await db.SaveChangesAsync(cancellationToken);
        await SessionAuthentication.SignInAsync(context, user, session.Id);
        return Results.Ok(user.ToDto("online"));
    }

    private static IResult RejectedLink(Messages messages) => Results.Problem(
        statusCode: StatusCodes.Status400BadRequest,
        title: messages.Get(MessageKey.BrowserLoginLinkInvalid));

    private static string HashSecret(string secret) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(secret)));

    private static bool SecretMatches(string supplied, string storedHash)
    {
        if (supplied.Length is < 16 or > 512 || storedHash.Length != HashLength)
        {
            return false;
        }

        return CryptographicOperations.FixedTimeEquals(
            Encoding.ASCII.GetBytes(HashSecret(supplied)),
            Encoding.ASCII.GetBytes(storedHash));
    }

    /// <summary>A small page for the system browser, which has nothing to run and nothing to leak.</summary>
    private static IResult Page(
        HttpContext context,
        Messages messages,
        string title,
        string message,
        int statusCode = StatusCodes.Status200OK)
    {
        var headers = context.Response.Headers;
        headers.CacheControl = "no-store";
        headers.ContentSecurityPolicy =
            "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
        headers["Referrer-Policy"] = "no-referrer";
        headers.XContentTypeOptions = "nosniff";

        var heading = WebUtility.HtmlEncode(title);
        var body = WebUtility.HtmlEncode(message);
        var html = $$"""
            <!doctype html>
            <html lang="{{messages.Language}}">
            <head>
              <meta charset="utf-8">
              <meta name="viewport" content="width=device-width, initial-scale=1">
              <title>{{heading}}</title>
              <style>
                :root { color-scheme: dark; font-family: Inter, system-ui, sans-serif; }
                body { min-height: 100vh; margin: 0; display: grid; place-items: center; background: #101112; color: #f3f1ec; }
                main { width: min(34rem, calc(100% - 2rem)); padding: 2rem; border: 1px solid #343638; border-radius: 1rem; background: #191b1d; }
                h1 { margin: 0 0 .75rem; font-size: 1.5rem; }
                p { margin: 0; color: #b8b9b7; line-height: 1.55; }
              </style>
            </head>
            <body><main><h1>{{heading}}</h1><p>{{body}}</p></main></body>
            </html>
            """;
        return Results.Content(html, "text/html", Encoding.UTF8, statusCode);
    }
}
