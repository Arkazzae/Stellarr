using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Auth;
using Stellarr.Api.Auth.Security;
using Stellarr.Api.Contracts;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;
using Stellarr.Api.Localization;

namespace Stellarr.Api.Endpoints;

/// <summary>
/// Exchanges the one short-lived credential an operator CLI issues after a
/// recovery. The result is enrollment-only access, never an app session.
/// </summary>
public static class CliRecoveryEndpoints
{
    public static IEndpointRouteBuilder MapCliRecoveryEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var recovery = endpoints.MapGroup("/api/auth/recovery");
        recovery.AddEndpointFilter(AuthEndpoints.NoStoreAsync);
        recovery.MapPost("/redeem", RedeemAsync)
            .RequireRateLimiting(RateLimitPolicies.Login);
        return endpoints;
    }

    private static async Task<IResult> RedeemAsync(
        CliRecoveryRedeemRequest request,
        AppDbContext db,
        Messages messages,
        HttpContext context,
        CancellationToken cancellationToken)
    {
        var token = request.Credential?.Trim() ?? "";
        if (token.Length is < 16 or > 512)
        {
            return Invalid(messages);
        }

        var now = DateTime.UtcNow;
        var hash = SecurityTokens.Hash(token);
        var credential = await db.CliRecoveryCredentials.Include(x => x.User)
            .SingleOrDefaultAsync(x => x.TokenHash == hash, cancellationToken);
        if (credential is null ||
            credential.UsedAt is not null ||
            credential.ExpiresAt <= now ||
            credential.User.IsDisabled ||
            !credential.User.SecurityRecoveryRequired ||
            credential.SecurityVersion != credential.User.SessionVersion)
        {
            return Invalid(messages);
        }

        var used = await db.CliRecoveryCredentials
            .Where(x => x.Id == credential.Id && x.UsedAt == null && x.ExpiresAt > now)
            .ExecuteUpdateAsync(setters => setters.SetProperty(x => x.UsedAt, now), cancellationToken);
        if (used != 1)
        {
            return Invalid(messages);
        }

        var policy = await MfaPolicy.LoadAsync(db, cancellationToken);
        var challenge = await AuthenticationFlow.CreateChallengeAsync(
            db, context, credential.User, "cli-recovery", AuthChallengePurposes.Recovery, policy, messages, cancellationToken);
        var methods = await AuthenticationFlow.ConfirmedMethodsAsync(db, credential.UserId, cancellationToken);
        SecurityEvents.Record(
            db, credential.UserId, SecurityEventKinds.CliRecovery, context, "recovery credential redeemed",
            await SecurityEvents.VerifiedEmailAsync(db, credential.UserId, cancellationToken));
        await db.SaveChangesAsync(cancellationToken);

        return Results.Ok(await AuthenticationFlow.DescribeAsync(
            db, context, credential.User, challenge, methods, policy, cancellationToken));
    }

    private static IResult Invalid(Messages messages) => Results.Problem(
        statusCode: StatusCodes.Status400BadRequest,
        title: messages.Get(MessageKey.SecurityRecoveryCredentialInvalid));
}
