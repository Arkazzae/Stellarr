using Stellarr.Api.Auth;
using Stellarr.Api.Contracts;
using Stellarr.Api.Data;
using Stellarr.Api.Realtime;

namespace Stellarr.Api.Endpoints;

public static class SessionEndpoints
{
    public static IEndpointRouteBuilder MapSessionEndpoints(this IEndpointRouteBuilder endpoints)
    {
        // Open to everyone: "nobody is signed in" is an answer, not an error.
        endpoints.MapGet("/api/session", GetSessionAsync);
        return endpoints;
    }

    private static async Task<IResult> GetSessionAsync(
        HttpContext context,
        AppDbContext db,
        PresenceTracker presence,
        CancellationToken cancellationToken)
    {
        if (context.User.Identity?.IsAuthenticated != true)
        {
            return Results.Ok(new SessionDto(null));
        }

        var user = await db.Users.FindAsync([context.User.RequireUserId()], cancellationToken);
        return Results.Ok(new SessionDto(user?.ToDto(presence.PresenceOf(user.Id))));
    }
}
