using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Auth;
using Stellarr.Api.Auth.Security;
using Stellarr.Api.Contracts;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;
using Stellarr.Api.Localization;
using Stellarr.Api.Realtime;

namespace Stellarr.Api.Endpoints;

public static class AuthEndpoints
{
    public static IEndpointRouteBuilder MapAuthEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var group = endpoints.MapGroup("/api/auth");
        group.AddEndpointFilter(NoStoreAsync);

        group.MapPost("/login", LoginAsync).RequireRateLimiting(RateLimitPolicies.Login);
        group.MapPost("/logout", LogoutAsync).RequireAuthorization();
        group.MapGet("/oidc", GetOidcStatus);
        group.MapGet("/oidc/login", ChallengeOidc).RequireRateLimiting(RateLimitPolicies.Login);
        group.MapGet("/oidc/{id}/login", ChallengeNamedOidc).RequireRateLimiting(RateLimitPolicies.Login);

        return endpoints;
    }

    internal static async ValueTask<object?> NoStoreAsync(
        EndpointFilterInvocationContext context,
        EndpointFilterDelegate next)
    {
        context.HttpContext.Response.Headers.CacheControl = "no-store";
        context.HttpContext.Response.Headers.Pragma = "no-cache";
        return await next(context);
    }

    private static async Task<IResult> LoginAsync(
        LoginRequest request,
        AppDbContext db,
        PasswordService passwords,
        Messages messages,
        HttpContext context,
        CancellationToken cancellationToken)
    {
        // Either the username or the e-mail address, in any letter case.
        var identifier = (request.Username?.Trim() ?? "").ToUpperInvariant();
        var user = await db.Users.SingleOrDefaultAsync(
            x => x.NormalizedUsername == identifier || x.NormalizedEmail == identifier,
            cancellationToken);
        if (user is null || user.IsDisabled || !passwords.Verify(request.Password ?? "", user.PasswordHash))
        {
            if (user is not null)
            {
                SecurityEvents.Record(db, user.Id, SecurityEventKinds.LoginFailed, context, "password");
                await db.SaveChangesAsync(cancellationToken);
            }

            // The same answer for every kind of failure, slowed a little so
            // that how quickly it comes back says little about which one it was.
            await Task.Delay(Random.Shared.Next(80, 180), cancellationToken);
            return Results.Problem(
                statusCode: StatusCodes.Status401Unauthorized,
                title: messages.Get(MessageKey.SignInFailed));
        }

        var policy = await MfaPolicy.LoadAsync(db, cancellationToken);
        var shortLived = request.KeepSignedIn == false;
        var start = await AuthenticationFlow.StartAsync(
            db, context, user, "password", policy, messages, cancellationToken, shortLived: shortLived);
        if (start.RecoveryRequired)
        {
            return Results.Ok(new { status = "security_recovery_required" });
        }

        if (start.Session is { } session)
        {
            db.UserSessions.Add(session);
            SecurityEvents.Record(
                db, user.Id, SecurityEventKinds.LoginSucceeded, context, "password",
                await SecurityEvents.VerifiedEmailAsync(db, user.Id, cancellationToken));
            await db.SaveChangesAsync(cancellationToken);
            await SessionAuthentication.SignInAsync(context, user, session.Id, shortLived);
            return Results.Ok(user.ToDto("online"));
        }

        await db.SaveChangesAsync(cancellationToken);
        return Results.Ok(start.Challenge);
    }

    /// <summary>
    /// The providers the sign-in page offers, each with its button's name and
    /// address. <c>enabled</c> and <c>displayName</c> describe the first one,
    /// as clients from before several providers read them.
    /// </summary>
    private static IResult GetOidcStatus(ExternalOidcOptions options, Messages messages)
    {
        var providers = options.ConfiguredProviders()
            .Select(provider => new
            {
                id = provider.Id,
                displayName = string.IsNullOrWhiteSpace(provider.DisplayName)
                    ? messages.Get(MessageKey.OidcDefaultName)
                    : provider.DisplayName,
                loginUrl = provider.LoginPath,
            })
            .ToArray();
        return Results.Ok(new
        {
            enabled = providers.Length > 0,
            displayName = providers.FirstOrDefault()?.displayName ??
                (string.IsNullOrWhiteSpace(options.DisplayName)
                    ? messages.Get(MessageKey.OidcDefaultName)
                    : options.DisplayName),
            providers,
        });
    }

    /// <summary>The original address: the provider configured first.</summary>
    private static IResult ChallengeOidc(string? returnUrl, bool? keepSignedIn, ExternalOidcOptions options) =>
        Challenge(options.ConfiguredProviders() is [var first, ..] ? first : null, returnUrl, keepSignedIn);

    private static IResult ChallengeNamedOidc(
        string id,
        string? returnUrl,
        bool? keepSignedIn,
        ExternalOidcOptions options) =>
        Challenge(options.Find(id), returnUrl, keepSignedIn);

    private static IResult Challenge(ExternalOidcProvider? provider, string? returnUrl, bool? keepSignedIn)
    {
        if (provider is null)
        {
            return Results.NotFound();
        }

        var properties = new AuthenticationProperties { RedirectUri = ExternalOidcOptions.SafeReturnUrl(returnUrl) };
        // Kept in the protected state, so the choice comes back with the provider's answer.
        ExternalOidcAuthentication.RememberShortLived(properties, keepSignedIn == false);
        return Results.Challenge(properties, [provider.Scheme]);
    }

    private static async Task<IResult> LogoutAsync(
        HttpContext context,
        AppDbContext db,
        HubConnectionRegistry connections,
        CancellationToken cancellationToken)
    {
        if (context.User.FindSessionId() is { } sessionId)
        {
            var now = DateTime.UtcNow;
            var changed = await db.UserSessions.Where(x => x.Id == sessionId && x.RevokedAt == null)
                .ExecuteUpdateAsync(setters => setters.SetProperty(x => x.RevokedAt, now), cancellationToken);
            if (changed == 1)
            {
                SecurityEvents.Record(
                    db, context.User.RequireUserId(), SecurityEventKinds.SessionRevoked, context, "logout");
                await db.SaveChangesAsync(cancellationToken);
            }

            connections.AbortSession(sessionId);
        }

        await context.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
        return Results.NoContent();
    }
}
