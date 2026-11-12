using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Auth.Security;
using Stellarr.Api.Data;
using Stellarr.Api.Localization;

namespace Stellarr.Api.Auth;

/// <summary>
/// Guards a change that could hand the instance or an account to someone
/// else: an account that has a second step must have passed it in the last
/// few minutes, in this very session. A session that is merely signed in, or
/// that skipped the step on a trusted device, is refused with a problem code
/// the client can act on.
/// </summary>
public sealed class FreshSecondStepFilter : IEndpointFilter
{
    public const string Code = "fresh-mfa-required";

    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next) =>
        await RefusalAsync(context.HttpContext) ?? await next(context);

    /// <summary>The refusal for a session without a fresh second step, or null when it has one.</summary>
    public static async Task<IResult?> RefusalAsync(HttpContext http)
    {
        var db = http.RequestServices.GetRequiredService<AppDbContext>();
        if (await MfaPolicy.HasFreshSecondStepAsync(
                db, http.User.RequireUserId(), http.User.FindSessionId(), http.RequestAborted))
        {
            return null;
        }

        return Results.Problem(
            statusCode: StatusCodes.Status403Forbidden,
            title: http.RequestServices.GetRequiredService<Messages>().Get(MessageKey.FreshSecondStepRequired),
            extensions: new Dictionary<string, object?> { ["code"] = Code });
    }
}

/// <summary>
/// <see cref="FreshSecondStepFilter"/> for the instance server only: the one
/// whose roles reach Cockpit's equivalents, which already ask for the step.
/// Other servers keep their ordinary role management.
/// </summary>
public sealed class InstanceServerFreshSecondStepFilter : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var http = context.HttpContext;
        var db = http.RequestServices.GetRequiredService<AppDbContext>();
        var instanceId = await db.Servers.AsNoTracking()
            .OrderBy(x => x.CreatedAt).ThenBy(x => x.Id)
            .Select(x => (Guid?)x.Id)
            .FirstOrDefaultAsync(http.RequestAborted);
        if (instanceId != http.RequireActiveServerId())
        {
            return await next(context);
        }

        return await FreshSecondStepFilter.RefusalAsync(http) ?? await next(context);
    }
}
