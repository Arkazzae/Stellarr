using Fido2NetLib;
using Fido2NetLib.Objects;
using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Auth;
using Stellarr.Api.Auth.Security;
using Stellarr.Api.Contracts;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;
using Stellarr.Api.Localization;

namespace Stellarr.Api.Endpoints;

/// <summary>
/// Signing in with a passkey alone. The passkey names the account and,
/// with user verification required, proves both the device and the person
/// holding it, so the session counts as having passed a second step.
/// </summary>
public static class PasskeySignInEndpoints
{
    /// <summary>How long the options stay good; a prompt left open longer starts again.</summary>
    private static readonly TimeSpan CeremonyLifetime = TimeSpan.FromMinutes(5);

    public static IEndpointRouteBuilder MapPasskeySignInEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var group = endpoints.MapGroup("/api/auth/passkey");
        group.AddEndpointFilter(AuthEndpoints.NoStoreAsync);
        group.MapGet("", (PasskeyRelyingParty relyingParty) => Results.Ok(new { available = relyingParty.Available }));
        group.MapPost("/options", OptionsAsync).RequireRateLimiting(RateLimitPolicies.Login);
        group.MapPost("/login", SignInAsync).RequireRateLimiting(RateLimitPolicies.Login);
        return endpoints;
    }

    private static async Task<IResult> OptionsAsync(
        AppDbContext db,
        PasskeyRelyingParty relyingParty,
        Messages messages,
        HttpContext context,
        CancellationToken cancellationToken)
    {
        if (relyingParty.Create() is not { } fido)
        {
            return Results.Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: messages.Get(MessageKey.SecurityPasskeyUnavailable));
        }

        var now = DateTime.UtcNow;
        await db.PasskeySignIns
            .Where(x => x.ExpiresAt <= now || x.ConsumedAt != null)
            .ExecuteDeleteAsync(cancellationToken);
        // No list of keys: the browser offers the passkeys it holds for this site.
        var options = fido.GetAssertionOptions(new GetAssertionOptionsParams
        {
            AllowedCredentials = [],
            UserVerification = UserVerificationRequirement.Required,
        });
        var secret = SecurityTokens.Random(32);
        var signIn = new PasskeySignIn
        {
            Id = Guid.NewGuid(),
            SecretHash = SecurityTokens.Hash(secret),
            Options = options.ToJson(),
            CreatedAt = now,
            ExpiresAt = now + CeremonyLifetime,
        };
        db.PasskeySignIns.Add(signIn);
        await db.SaveChangesAsync(cancellationToken);
        SecurityCookies.SetPasskey(context, signIn.Id, secret, signIn.ExpiresAt);
        return Results.Content(signIn.Options, "application/json");
    }

    private static async Task<IResult> SignInAsync(
        PasskeySignInRequest request,
        AppDbContext db,
        PasskeyRelyingParty relyingParty,
        Messages messages,
        HttpContext context,
        CancellationToken cancellationToken)
    {
        if (relyingParty.Create() is not { } fido)
        {
            return Results.Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: messages.Get(MessageKey.SecurityPasskeyUnavailable));
        }

        var cookie = SecurityCookies.ReadPasskey(context);
        SecurityCookies.ClearPasskey(context);
        var now = DateTime.UtcNow;
        var signIn = cookie is { } bound
            ? await db.PasskeySignIns.AsNoTracking().SingleOrDefaultAsync(x => x.Id == bound.Id, cancellationToken)
            : null;
        if (signIn is null || !SecurityTokens.Matches(cookie!.Value.Secret, signIn.SecretHash))
        {
            return await RejectedAsync(messages, cancellationToken);
        }

        // One answer per set of options, right or wrong.
        var taken = await db.PasskeySignIns
            .Where(x => x.Id == signIn.Id && x.ConsumedAt == null && x.ExpiresAt > now)
            .ExecuteUpdateAsync(setters => setters.SetProperty(x => x.ConsumedAt, now), cancellationToken);
        if (taken != 1 ||
            request.Response is not { RawId.Length: > 0 } response ||
            response.Response?.UserHandle is not { Length: > 0 } userHandle)
        {
            return await RejectedAsync(messages, cancellationToken);
        }

        var credential = await Passkeys.Active(db).AsNoTracking()
            .Include(x => x.User)
            .SingleOrDefaultAsync(x => x.CredentialId == response.RawId, cancellationToken);
        // The library compares the handle only through a callback; the
        // account the key belongs to is checked here, before anything else.
        if (credential is null || !userHandle.AsSpan().SequenceEqual(credential.UserHandle))
        {
            return await RejectedAsync(messages, cancellationToken);
        }

        await using var transaction = await db.Database.BeginTransactionAsync(
            System.Data.IsolationLevel.Serializable, cancellationToken);
        var user = await db.Users.SingleAsync(x => x.Id == credential.UserId, cancellationToken);
        // A pending operator's recovery blocks every way in but its own.
        if (user.IsDisabled || user.SecurityRecoveryRequired ||
            !await Passkeys.VerifyAsync(
                db, fido, credential, response, AssertionOptions.FromJson(signIn.Options), cancellationToken))
        {
            SecurityEvents.Record(db, user.Id, SecurityEventKinds.LoginFailed, context, "passkey");
            await db.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return await RejectedAsync(messages, cancellationToken);
        }

        var shortLived = request.KeepSignedIn == false;
        var session = SessionAuthentication.CreateSession(
            context, user.Id, messages, MfaMethodTypes.Passkey, now, MfaMethodTypes.Passkey,
            user.SessionVersion, now, shortLived);
        db.UserSessions.Add(session);
        SecurityEvents.Record(
            db, user.Id, SecurityEventKinds.LoginSucceeded, context, MfaMethodTypes.Passkey,
            await SecurityEvents.VerifiedEmailAsync(db, user.Id, cancellationToken));
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        await SessionAuthentication.SignInAsync(context, user, session.Id, shortLived);
        return Results.Ok(user.ToDto("online"));
    }

    /// <summary>The same answer for every failure, slowed a little like the password's.</summary>
    private static async Task<IResult> RejectedAsync(Messages messages, CancellationToken cancellationToken)
    {
        await Task.Delay(Random.Shared.Next(80, 180), cancellationToken);
        return Results.Problem(
            statusCode: StatusCodes.Status401Unauthorized,
            title: messages.Get(MessageKey.SecurityPasskeyRejected));
    }
}
