using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Auth;
using Stellarr.Api.Contracts;
using Stellarr.Api.Data;

namespace Stellarr.Api.Endpoints;

public static class AuthEndpoints
{
    public static IEndpointRouteBuilder MapAuthEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var group = endpoints.MapGroup("/api/auth");

        group.MapPost("/login", LoginAsync).RequireRateLimiting(RateLimitPolicies.Login);
        group.MapPost("/logout", LogoutAsync).RequireAuthorization();

        return endpoints;
    }

    private static async Task<IResult> LoginAsync(
        LoginRequest request,
        AppDbContext db,
        PasswordService passwords,
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
                title: "Nieprawidłowy login lub hasło.");
        }

        var session = SessionAuthentication.CreateSession(context, user.Id);
        db.UserSessions.Add(session);
        await db.SaveChangesAsync(cancellationToken);
        await SessionAuthentication.SignInAsync(context, user, session.Id);
        return Results.Ok(user.ToDto("online"));
    }

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
