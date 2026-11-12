using System.Net;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Auth;
using Stellarr.Api.Auth.Security;
using Stellarr.Api.Contracts;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;
using Stellarr.Api.Localization;

namespace Stellarr.Api.Endpoints;

/// <summary>
/// Signs the desktop client in through the system browser, where the single
/// sign-on provider works. The client starts a request and keeps its secret,
/// the browser approves the request in an explicit POST, and the client then
/// trades id and secret for its own session. The browser never learns the
/// client secret and never sees the session cookie.
/// </summary>
public static class DesktopBrowserLoginEndpoints
{
    private const int SecretBytes = 32;
    private const int HashLength = 64;
    private static readonly TimeSpan RequestLifetime = TimeSpan.FromMinutes(2);

    public static IEndpointRouteBuilder MapDesktopBrowserLoginEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var group = endpoints.MapGroup("/api/auth/desktop/browser");
        group.AddEndpointFilter(AuthEndpoints.NoStoreAsync);

        group.MapPost("/start", StartAsync).RequireRateLimiting(RateLimitPolicies.Login);
        group.MapGet("/verify/{requestId:guid}", RenderApprovalAsync).RequireAuthorization();
        group.MapPost("/verify/{requestId:guid}", ApproveAsync).RequireAuthorization();
        // Polled while the person signs in, so it has a budget apart from password attempts.
        group.MapPost("/exchange", ExchangeAsync).RequireRateLimiting(RateLimitPolicies.LoginPoll);

        return endpoints;
    }

    private static async Task<IResult> StartAsync(
        AppDbContext db,
        ExternalOidcOptions oidc,
        CancellationToken cancellationToken)
    {
        var providers = oidc.ConfiguredProviders();
        if (providers.Count == 0)
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
            // One provider: straight to it. Several: the sign-in page, which offers them all.
            verificationUrl = providers.Count == 1
                ? $"{providers[0].LoginPath}?returnUrl={Uri.EscapeDataString(approvalPath)}"
                : $"/login?returnUrl={Uri.EscapeDataString(approvalPath)}",
            expiresAt = login.ExpiresAt,
        });
    }

    /// <summary>Shows a confirmation and a bound CSRF token. It never approves by itself.</summary>
    private static async Task<IResult> RenderApprovalAsync(
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

        if (login.ApprovalUserId is { } intendedBy && intendedBy != userId)
        {
            return Results.Conflict(new { title = messages.Get(MessageKey.BrowserLoginApprovedByAnother) });
        }

        if (login.ApprovedAt is not null)
        {
            return Page(
                context,
                messages,
                messages.Get(MessageKey.BrowserLoginDoneHeading),
                messages.Get(MessageKey.BrowserLoginDoneBody));
        }

        var session = await SourceSessionAsync(context, db, userId, now, cancellationToken);
        if (session is null)
        {
            return Results.Forbid();
        }

        var token = SecurityTokens.Random(32);
        login.ApprovalUserId = userId;
        login.ApprovalSessionId = session.Id;
        login.ApprovalTokenHash = SecurityTokens.Hash(token);
        await db.SaveChangesAsync(cancellationToken);
        return ConfirmPage(
            context,
            messages,
            messages.Get(MessageKey.BrowserLoginConfirmHeading),
            messages.Get(MessageKey.BrowserLoginConfirmBody),
            messages.Get(MessageKey.BrowserLoginConfirmButton),
            $"/api/auth/desktop/browser/verify/{requestId}",
            token);
    }

    private static async Task<IResult> ApproveAsync(
        Guid requestId,
        Messages messages,
        HttpContext context,
        AppDbContext db,
        CancellationToken cancellationToken)
    {
        if (!IsSameOrigin(context))
        {
            return Results.BadRequest();
        }

        var userId = context.User.RequireUserId();
        var form = await context.Request.ReadFormAsync(cancellationToken);
        var token = form["token"].ToString();
        var now = DateTime.UtcNow;
        var login = await db.DesktopBrowserLogins.SingleOrDefaultAsync(x => x.Id == requestId, cancellationToken);
        var session = await SourceSessionAsync(context, db, userId, now, cancellationToken);
        if (login is null || session is null || login.ExpiresAt <= now || login.RedeemedAt is not null ||
            login.ApprovedAt is not null ||
            login.ApprovalUserId != userId ||
            login.ApprovalSessionId != session.Id ||
            login.ApprovalTokenHash is not { Length: 64 } storedHash ||
            token.Length is < 16 or > 512 ||
            !SecurityTokens.Matches(token, storedHash))
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

        var user = await db.Users.AsNoTracking().SingleOrDefaultAsync(
            x => x.Id == userId && !x.IsDisabled, cancellationToken);
        if (user is null)
        {
            return Results.Forbid();
        }

        var approved = await db.DesktopBrowserLogins
            .Where(x => x.Id == requestId &&
                x.ApprovedAt == null &&
                x.RedeemedAt == null &&
                x.ExpiresAt > now &&
                x.ApprovalUserId == userId &&
                x.ApprovalSessionId == session.Id &&
                x.ApprovalTokenHash == storedHash)
            .ExecuteUpdateAsync(
                setters => setters
                    .SetProperty(x => x.UserId, userId)
                    .SetProperty(x => x.ApprovedSessionId, session.Id)
                    .SetProperty(x => x.PrimarySource, session.PrimarySource)
                    .SetProperty(x => x.MfaCompletedAt, session.MfaCompletedAt)
                    .SetProperty(x => x.MfaEvidence, session.MfaEvidence)
                    .SetProperty(x => x.SecurityVersion, user.SessionVersion)
                    .SetProperty(x => x.ApprovedAt, now)
                    .SetProperty(x => x.ApprovalTokenHash, (string?)null),
                cancellationToken);
        if (approved != 1)
        {
            return Page(
                context,
                messages,
                messages.Get(MessageKey.BrowserLoginExpiredHeading),
                messages.Get(MessageKey.BrowserLoginExpiredBody),
                StatusCodes.Status410Gone);
        }

        SecurityEvents.Record(
            db, userId, SecurityEventKinds.DesktopApproved, context, "browser approval",
            await SecurityEvents.VerifiedEmailAsync(db, userId, cancellationToken));
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

        await using var transaction = await db.Database.BeginTransactionAsync(
            System.Data.IsolationLevel.Serializable, cancellationToken);
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"UPDATE \"Users\" SET \"SessionVersion\" = \"SessionVersion\" WHERE \"Id\" = {userId};",
            cancellationToken);
        await db.Entry(login).ReloadAsync(cancellationToken);
        now = DateTime.UtcNow;
        if (login.UserId != userId || login.ApprovedAt is null ||
            login.ExpiresAt <= now || login.RedeemedAt is not null)
        {
            return login.UserId != userId || login.ApprovedAt is null
                ? Results.Accepted(value: new { status = "pending" })
                : RejectedLink(messages);
        }

        var user = await db.Users.SingleOrDefaultAsync(x => x.Id == userId && !x.IsDisabled, cancellationToken);
        if (user is null || user.SecurityRecoveryRequired)
        {
            return Results.Forbid();
        }

        var source = login.ApprovedSessionId is { } sourceId
            ? await db.UserSessions.AsNoTracking().SingleOrDefaultAsync(
                x => x.Id == sourceId && x.UserId == userId,
                cancellationToken)
            : null;
        var hardEnd = source?.AbsoluteExpiresAt ?? source?.CreatedAt.Add(SessionAuthentication.Lifetime);
        if (source is null ||
            source.RevokedAt is not null ||
            source.ExpiresAt <= now ||
            hardEnd <= now ||
            login.SecurityVersion != user.SessionVersion ||
            source.SecurityVersion != user.SessionVersion)
        {
            return Results.Forbid();
        }

        var policy = await MfaPolicy.LoadAsync(db, cancellationToken);
        var hasMethods = await MfaPolicy.HasConfirmedMethodAsync(db, userId, cancellationToken);
        var required = await MfaPolicy.IsRequiredAtLoginAsync(db, policy, userId, cancellationToken);
        if ((hasMethods || required) &&
            !MfaPolicy.IsSatisfied(login.MfaCompletedAt is not null, login.MfaEvidence, policy.MfaRequirement))
        {
            return Results.Forbid();
        }

        var redeemed = await db.DesktopBrowserLogins
            .Where(x => x.Id == requestId && x.RedeemedAt == null && x.ExpiresAt > now)
            .ExecuteUpdateAsync(setters => setters.SetProperty(x => x.RedeemedAt, now), cancellationToken);
        if (redeemed != 1)
        {
            return RejectedLink(messages);
        }

        var session = SessionAuthentication.CreateSession(
            context,
            user.Id,
            messages,
            login.PrimarySource ?? "desktop",
            login.MfaCompletedAt,
            login.MfaEvidence,
            user.SessionVersion,
            source.AuthenticatedAt ?? source.CreatedAt,
            // The desktop app keeps its own cookie jar across restarts; a
            // browser-length cookie would sign it out at every quit.
            shortLived: false);
        db.UserSessions.Add(session);
        SecurityEvents.Record(
            db, user.Id, SecurityEventKinds.LoginSucceeded, context, "desktop",
            await SecurityEvents.VerifiedEmailAsync(db, user.Id, cancellationToken));
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        await SessionAuthentication.SignInAsync(context, user, session.Id, shortLived: false);
        return Results.Ok(user.ToDto("online"));
    }

    private static Task<UserSession?> SourceSessionAsync(
        HttpContext context,
        AppDbContext db,
        Guid userId,
        DateTime now,
        CancellationToken cancellationToken) =>
        context.User.FindSessionId() is { } sessionId
            ? SourceSessionQuery(db, sessionId, userId, now, now - SessionAuthentication.Lifetime)
                .SingleOrDefaultAsync(cancellationToken)
            : Task.FromResult<UserSession?>(null);

    private static IQueryable<UserSession> SourceSessionQuery(
        AppDbContext db,
        Guid sessionId,
        Guid userId,
        DateTime now,
        DateTime legacyCreatedAfter) =>
        db.UserSessions.AsNoTracking().Where(
            x => x.Id == sessionId &&
                x.UserId == userId &&
                x.RevokedAt == null &&
                x.ExpiresAt > now &&
                !x.User.IsDisabled &&
                (x.AbsoluteExpiresAt > now ||
                    (x.AbsoluteExpiresAt == null && x.CreatedAt > legacyCreatedAfter)));

    /// <summary>
    /// Browser form posts must come from this exact origin. Non-browser clients
    /// without Origin/Referer are accepted and still need the bound token.
    /// </summary>
    private static bool IsSameOrigin(HttpContext context)
    {
        var expected = $"{context.Request.Scheme}://{context.Request.Host}";
        var origin = context.Request.Headers.Origin.ToString();
        if (origin.Length > 0)
        {
            return string.Equals(origin.TrimEnd('/'), expected, StringComparison.OrdinalIgnoreCase);
        }

        var referer = context.Request.Headers.Referer.ToString();
        return referer.Length == 0 ||
            (Uri.TryCreate(referer, UriKind.Absolute, out var uri) &&
                string.Equals($"{uri.Scheme}://{uri.Authority}", expected, StringComparison.OrdinalIgnoreCase));
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
        return Content(context, html, statusCode);
    }

    private static IResult ConfirmPage(
        HttpContext context,
        Messages messages,
        string title,
        string message,
        string button,
        string action,
        string token)
    {
        var heading = WebUtility.HtmlEncode(title);
        var body = WebUtility.HtmlEncode(message);
        var label = WebUtility.HtmlEncode(button);
        var target = WebUtility.HtmlEncode(action);
        var hidden = WebUtility.HtmlEncode(token);
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
                p { margin: 0 0 1.5rem; color: #b8b9b7; line-height: 1.55; }
                button { padding: .8rem 1.1rem; border: 0; border-radius: .5rem; background: #d6a554; color: #17130d; font: inherit; font-weight: 700; cursor: pointer; }
              </style>
            </head>
            <body><main>
              <h1>{{heading}}</h1>
              <p>{{body}}</p>
              <form method="post" action="{{target}}">
                <input type="hidden" name="token" value="{{hidden}}">
                <button type="submit">{{label}}</button>
              </form>
            </main></body>
            </html>
            """;
        return Content(context, html, StatusCodes.Status200OK);
    }

    private static IResult Content(HttpContext context, string html, int statusCode)
    {
        var headers = context.Response.Headers;
        headers.CacheControl = "no-store";
        headers.ContentSecurityPolicy =
            "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
        headers["Referrer-Policy"] = "no-referrer";
        headers.XContentTypeOptions = "nosniff";
        return Results.Content(html, "text/html", Encoding.UTF8, statusCode);
    }
}
