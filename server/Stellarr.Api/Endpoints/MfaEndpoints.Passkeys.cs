using Fido2NetLib;
using Fido2NetLib.Objects;
using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Auth.Security;
using Stellarr.Api.Contracts;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;
using Stellarr.Api.Localization;

namespace Stellarr.Api.Endpoints;

/// <summary>
/// Passkeys and security keys as a second step and as a method to set up.
/// Every ceremony runs on a pending challenge: its options are generated and
/// kept here, the browser signs them, and the answer is checked against the
/// kept copy, which one attempt clears.
/// </summary>
public static partial class MfaEndpoints
{
    private static async Task<IResult> PasskeyOptionsAsync(
        PasskeyOptionsRequest request,
        AppDbContext db,
        PasskeyRelyingParty relyingParty,
        Messages messages,
        HttpContext context,
        CancellationToken cancellationToken)
    {
        var check = await AuthenticationFlow.ValidateAsync(
            db, context, request.ChallengeId, purpose: null, cancellationToken);
        if (check.Challenge is not { } challenge ||
            challenge.Purpose is not (AuthChallengePurposes.Mfa or AuthChallengePurposes.Reverify))
        {
            return ChallengeProblem(check.Status, messages);
        }

        if (relyingParty.Create() is not { } fido)
        {
            return PasskeysUnavailable(messages);
        }

        var credentials = await Passkeys.DescriptorsAsync(db, challenge.UserId, cancellationToken);
        if (credentials.Count == 0)
        {
            return MethodUnavailable(messages);
        }

        var options = fido.GetAssertionOptions(new GetAssertionOptionsParams
        {
            AllowedCredentials = credentials,
            UserVerification = UserVerificationRequirement.Required,
        });
        challenge.WebAuthnOptions = options.ToJson();
        await db.SaveChangesAsync(cancellationToken);
        return Results.Content(challenge.WebAuthnOptions, "application/json");
    }

    private static async Task<IResult> VerifyPasskeyAsync(
        PasskeyVerifyRequest request,
        AppDbContext db,
        PasskeyRelyingParty relyingParty,
        Messages messages,
        HttpContext context,
        CancellationToken cancellationToken)
    {
        var policy = await MfaPolicy.LoadAsync(db, cancellationToken);
        var check = await AuthenticationFlow.ValidateAsync(
            db, context, request.ChallengeId, purpose: null, cancellationToken);
        if (check.Challenge is not { } challenge ||
            challenge.Purpose is not (AuthChallengePurposes.Mfa or AuthChallengePurposes.Reverify))
        {
            return ChallengeProblem(check.Status, messages);
        }

        if (relyingParty.Create() is not { } fido)
        {
            return PasskeysUnavailable(messages);
        }

        var response = request.Response;
        return await CompleteAsync(
            db, context, challenge, policy, messages, MfaMethodTypes.Passkey,
            fresh: true, request.RememberDevice, recoveryCodes: null, cancellationToken,
            consumeProof: async user =>
            {
                // The kept options go with the first attempt, right or wrong.
                if (await TakePasskeyOptionsAsync(db, challenge.Id, cancellationToken) is not { } stored ||
                    response?.RawId is not { Length: > 0 } rawId)
                {
                    return false;
                }

                var credential = await Passkeys.Active(db).AsNoTracking()
                    .SingleOrDefaultAsync(x => x.CredentialId == rawId && x.UserId == user.Id, cancellationToken);
                return credential is not null &&
                    await Passkeys.VerifyAsync(
                        db, fido, credential, response, AssertionOptions.FromJson(stored), cancellationToken);
            });
    }

    private static async Task<IResult> StartPasskeyAsync(
        PasskeyOptionsRequest request,
        AppDbContext db,
        PasskeyRelyingParty relyingParty,
        Messages messages,
        HttpContext context,
        CancellationToken cancellationToken)
    {
        var check = await AuthenticationFlow.ValidateAsync(
            db, context, request.ChallengeId, purpose: null, cancellationToken);
        if (check.Challenge is not { } challenge || !IsEnrollmentPurpose(challenge.Purpose))
        {
            return ChallengeProblem(check.Status, messages);
        }

        if (relyingParty.Create() is not { } fido)
        {
            return PasskeysUnavailable(messages);
        }

        var user = challenge.User;
        var options = fido.RequestNewCredential(new RequestNewCredentialParams
        {
            User = new Fido2User
            {
                Id = Passkeys.UserHandle(user.Id),
                Name = user.Username,
                DisplayName = user.DisplayName,
            },
            // A key already on this account is not registered a second time.
            ExcludeCredentials = await Passkeys.DescriptorsAsync(db, user.Id, cancellationToken),
            AuthenticatorSelection = new AuthenticatorSelection
            {
                // Preferred, so a security key that cannot store the account
                // still works as a second step; a passkey stores it and can
                // also sign in without the password.
                ResidentKey = ResidentKeyRequirement.Preferred,
                UserVerification = UserVerificationRequirement.Required,
            },
            AttestationPreference = AttestationConveyancePreference.None,
        });
        challenge.WebAuthnOptions = options.ToJson();
        await db.SaveChangesAsync(cancellationToken);
        return Results.Content(challenge.WebAuthnOptions, "application/json");
    }

    private static async Task<IResult> ConfirmPasskeyAsync(
        PasskeyEnrollConfirmRequest request,
        AppDbContext db,
        PasskeyRelyingParty relyingParty,
        Messages messages,
        HttpContext context,
        CancellationToken cancellationToken)
    {
        var check = await AuthenticationFlow.ValidateAsync(
            db, context, request.ChallengeId, purpose: null, cancellationToken);
        if (check.Challenge is not { } challenge || !IsEnrollmentPurpose(challenge.Purpose))
        {
            return ChallengeProblem(check.Status, messages);
        }

        var name = MethodName(request.Name, messages.Get(MessageKey.SecurityDefaultPasskeyName), messages);
        if (name is null)
        {
            return InvalidName(messages);
        }

        if (relyingParty.Create() is not { } fido)
        {
            return PasskeysUnavailable(messages);
        }

        if (await FailureBudgetSpentAsync(db, challenge.UserId, messages, cancellationToken) is { } spent)
        {
            return spent;
        }

        var stored = await TakePasskeyOptionsAsync(db, challenge.Id, cancellationToken);
        RegisteredPublicKeyCredential? registered = null;
        if (stored is not null && request.Response is { } response)
        {
            try
            {
                registered = await fido.MakeNewCredentialAsync(new MakeNewCredentialParams
                {
                    AttestationResponse = response,
                    OriginalOptions = CredentialCreateOptions.FromJson(stored),
                    IsCredentialIdUniqueToUserCallback = async (args, token) =>
                        !await db.WebAuthnCredentials.AnyAsync(x => x.CredentialId == args.CredentialId, token),
                }, cancellationToken);
            }
            catch (Fido2VerificationException)
            {
                registered = null;
            }
        }

        if (registered is null)
        {
            await AuthenticationFlow.FailAttemptAsync(db, challenge, cancellationToken);
            SecurityEvents.Record(
                db, challenge.UserId, SecurityEventKinds.MfaFailed, context, "passkey-enrollment");
            await db.SaveChangesAsync(cancellationToken);
            return PasskeyRejected(messages);
        }

        var now = DateTime.UtcNow;
        return await FinishEnrollmentAsync(
            db, context, challenge, messages, MfaMethodTypes.Passkey, request.RememberDevice,
            notificationEmail: null,
            async user =>
            {
                // Checked again under the transaction: two setups racing with
                // one key must not both keep it.
                if (await db.WebAuthnCredentials.AnyAsync(x => x.CredentialId == registered.Id, cancellationToken))
                {
                    return false;
                }

                var method = new MfaMethod
                {
                    Id = Guid.NewGuid(),
                    UserId = user.Id,
                    Type = MfaMethodTypes.Passkey,
                    Name = name,
                    CreatedAt = now,
                    ConfirmedAt = now,
                    LastUsedAt = now,
                };
                db.MfaMethods.Add(method);
                db.WebAuthnCredentials.Add(new WebAuthnCredential
                {
                    Id = Guid.NewGuid(),
                    MethodId = method.Id,
                    UserId = user.Id,
                    CredentialId = registered.Id,
                    PublicKey = registered.PublicKey,
                    UserHandle = Passkeys.UserHandle(user.Id),
                    SignCount = registered.SignCount,
                    BackupEligible = registered.IsBackupEligible,
                    BackedUp = registered.IsBackedUp,
                    AaGuid = registered.AaGuid,
                    Transports = Passkeys.WriteTransports(registered.Transports),
                    CreatedAt = now,
                    LastUsedAt = now,
                });
                return true;
            },
            cancellationToken);
    }

    /// <summary>Takes the kept options off the challenge, once; null if another request took them.</summary>
    private static async Task<string?> TakePasskeyOptionsAsync(
        AppDbContext db,
        Guid challengeId,
        CancellationToken cancellationToken)
    {
        var stored = await db.AuthChallenges.AsNoTracking()
            .Where(x => x.Id == challengeId)
            .Select(x => x.WebAuthnOptions)
            .SingleOrDefaultAsync(cancellationToken);
        if (stored is null)
        {
            return null;
        }

        var taken = await db.AuthChallenges
            .Where(x => x.Id == challengeId && x.WebAuthnOptions == stored)
            .ExecuteUpdateAsync(setters => setters.SetProperty(x => x.WebAuthnOptions, (string?)null), cancellationToken);
        return taken == 1 ? stored : null;
    }

    private static IResult PasskeysUnavailable(Messages messages) => Results.Problem(
        statusCode: StatusCodes.Status409Conflict,
        title: messages.Get(MessageKey.SecurityPasskeyUnavailable));

    private static IResult PasskeyRejected(Messages messages) => Results.Problem(
        statusCode: StatusCodes.Status401Unauthorized,
        title: messages.Get(MessageKey.SecurityPasskeyRejected));
}
