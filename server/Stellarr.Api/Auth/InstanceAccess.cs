using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;

namespace Stellarr.Api.Auth;

/// <summary>
/// Who may administer the instance as a whole. The first server ever created
/// is the instance server and only its owner passes: owning a server that
/// somebody created later gives no say over the instance.
/// </summary>
public static class InstanceAccess
{
    internal const string ContextItemKey = "Stellarr.InstanceServer";

    /// <returns>
    /// The instance server, tracked by <paramref name="db"/>, when the user owns
    /// it; otherwise null.
    /// </returns>
    public static Task<StellarrServer?> FindAdministeredServerAsync(
        AppDbContext db,
        Guid userId,
        CancellationToken cancellationToken = default) =>
        db.Servers
            .OrderBy(x => x.CreatedAt).ThenBy(x => x.Id)
            .Take(1)
            .Where(x => db.ServerMembers.Any(
                member => member.ServerId == x.Id && member.UserId == userId && member.Role.IsOwner))
            .FirstOrDefaultAsync(cancellationToken);

    /// <summary>The instance server of the request; only available behind <see cref="InstanceOwnerFilter"/>.</summary>
    public static StellarrServer RequireInstanceServer(this HttpContext context) =>
        context.Items.TryGetValue(ContextItemKey, out var value) && value is StellarrServer server
            ? server
            : throw new InvalidOperationException(
                "The instance server is unavailable before InstanceOwnerFilter runs.");
}

/// <summary>
/// Lets only the owner of the instance server through and hands the server on
/// to the endpoint. Endpoints that use it must also require authorization.
/// </summary>
public sealed class InstanceOwnerFilter : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(
        EndpointFilterInvocationContext context,
        EndpointFilterDelegate next)
    {
        var http = context.HttpContext;
        var server = await InstanceAccess.FindAdministeredServerAsync(
            http.RequestServices.GetRequiredService<AppDbContext>(),
            http.User.RequireUserId(),
            http.RequestAborted);
        if (server is null)
        {
            return Results.Forbid();
        }

        http.Items[InstanceAccess.ContextItemKey] = server;
        return await next(context);
    }
}
