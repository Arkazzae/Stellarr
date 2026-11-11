using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Auth;
using Stellarr.Api.Contracts;
using Stellarr.Api.Data;
using Stellarr.Api.Localization;

namespace Stellarr.Api.Endpoints;

public static class AuthEndpoints
{
    public static IEndpointRouteBuilder MapAuthEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var group = endpoints.MapGroup("/api/auth");

        group.MapPost("/login", LoginAsync).RequireRateLimiting(RateLimitPolicies.Login);
        group.MapPost("/logout", LogoutAsync).RequireAuthorization();
        group.MapGet("/oidc", GetOidcStatus);
        group.MapGet("/oidc/login", ChallengeOidc).RequireRateLimiting(RateLimitPolicies.Login);

        return endpoints;
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
            // The same answer for every kind of failure, slowed a little so
            // that how quickly it comes back says little about which one it was.
            await Task.Delay(Random.Shared.Next(80, 180), cancellationToken);
            return Results.Problem(
                statusCode: StatusCodes.Status401Unauthorized,
                title: messages.Get(MessageKey.SignInFailed));
        }

        var session = SessionAuthentication.CreateSession(context, user.Id, messages);
        db.UserSessions.Add(session);
        await db.SaveChangesAsync(cancellationToken);
        await SessionAuthentication.SignInAsync(context, user, session.Id);
        return Results.Ok(user.ToDto("online"));
    }

    /// <summary>Whether the sign-in page should offer the provider, and under what name.</summary>
    private static IResult GetOidcStatus(ExternalOidcOptions options, Messages messages) =>
        Results.Ok(new
        {
            enabled = options.IsConfigured,
            displayName = string.IsNullOrWhiteSpace(options.DisplayName)
                ? messages.Get(MessageKey.OidcDefaultName)
                : options.DisplayName,
        });

    private static IResult ChallengeOidc(string? returnUrl, ExternalOidcOptions options) =>
        options.IsConfigured
            ? Results.Challenge(
                new AuthenticationProperties { RedirectUri = ExternalOidcOptions.SafeReturnUrl(returnUrl) },
                [ExternalOidcOptions.AuthenticationScheme])
            : Results.NotFound();

    private static async Task<IResult> LogoutAsync(
        HttpContext context,
        AppDbContext db,
        CancellationToken cancellationToken)
    {
        if (context.User.FindSessionId() is { } sessionId)
        {
            var now = DateTime.UtcNow;
            await db.UserSessions.Where(x => x.Id == sessionId && x.RevokedAt == null)
                .ExecuteUpdateAsync(setters => setters.SetProperty(x => x.RevokedAt, now), cancellationToken);
        }

        await context.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
        return Results.NoContent();
    }
}
