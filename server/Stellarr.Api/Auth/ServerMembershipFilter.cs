using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Data;

namespace Stellarr.Api.Auth;

/// <summary>
/// Resolves the server a request is about and keeps people out of servers
/// they were removed from. The client names a membership with a header or a
/// <c>serverId</c> query value; without either, the server the caller joined
/// first is used. Endpoints that use it must also require authorization.
/// </summary>
public sealed class ServerMembershipFilter : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(
        EndpointFilterInvocationContext context,
        EndpointFilterDelegate next)
    {
        var http = context.HttpContext;
        var userId = http.User.RequireUserId();
        var memberships = http.RequestServices.GetRequiredService<AppDbContext>()
            .ServerMembers.AsNoTracking()
            .Where(x => x.UserId == userId);

        var selection = http.Request.Headers[ServerAccess.HeaderName].FirstOrDefault()
            ?? http.Request.Query["serverId"].FirstOrDefault();
        Guid? serverId;
        if (string.IsNullOrWhiteSpace(selection))
        {
            serverId = await memberships
                .OrderBy(x => x.JoinedAt).ThenBy(x => x.ServerId)
                .Select(x => (Guid?)x.ServerId)
                .FirstOrDefaultAsync(http.RequestAborted);
        }
        else if (Guid.TryParse(selection, out var requested))
        {
            serverId = await memberships
                .Where(x => x.ServerId == requested)
                .Select(x => (Guid?)x.ServerId)
                .SingleOrDefaultAsync(http.RequestAborted);
        }
        else
        {
            return Results.BadRequest();
        }

        if (serverId is not { } active)
        {
            return Results.Forbid();
        }

        http.Items[ServerAccess.ContextItemKey] = active;
        return await next(context);
    }
}
