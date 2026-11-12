using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Stellarr.Api.Auth;
using Stellarr.Api.Auth.Security;
using Stellarr.Api.Contracts;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;
using Stellarr.Api.Localization;
using Stellarr.Api.Mail;
using Stellarr.Api.Secrets;

namespace Stellarr.Api.Endpoints;

/// <summary>
/// The short-lived second half of a sign-in. Every route works only with the
/// browser-bound pre-authentication cookie issued by the primary proof.
/// </summary>
public static class MfaEndpoints
{
    public static IEndpointRouteBuilder MapMfaEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var group = endpoints.MapGroup("/api/auth/mfa");
        group.AddEndpointFilter(AuthEndpoints.NoStoreAsync);
        group.MapGet("/pending", PendingAsync).RequireRateLimiting(RateLimitPolicies.LoginPoll);
        group.MapPost("/cancel", CancelAsync).RequireRateLimiting(RateLimitPolicies.AuthWrite);
        group.MapPost("/verify", VerifyAsync).RequireRateLimiting(RateLimitPolicies.Login);
        group.MapPost("/email/send", SendEmailAsync).RequireRateLimiting(RateLimitPolicies.AuthWrite);
        group.MapPost("/enroll/totp/start", StartTotpAsync).RequireRateLimiting(RateLimitPolicies.AuthWrite);
        group.MapPost("/enroll/totp/confirm", ConfirmTotpAsync).RequireRateLimiting(RateLimitPolicies.Login);
        group.MapPost("/enroll/email/start", StartEmailAsync).RequireRateLimiting(RateLimitPolicies.AuthWrite);
        group.MapPost("/enroll/email/confirm", ConfirmEmailAsync).RequireRateLimiting(RateLimitPolicies.Login);
        return endpoints;
    }

    private static async Task<IResult> PendingAsync(
        AppDbContext db,
        Messages messages,
        HttpContext context,
        CancellationToken cancellationToken)
    {
        if (SecurityCookies.ReadPreauth(context) is not { } cookie)
        {
            return ChallengeProblem(ChallengeStatus.Missing, messages);
        }

        var check = await AuthenticationFlow.ValidateAsync(
            db, context, cookie.Id.ToString(), purpose: null, cancellationToken);
        if (check.Challenge is not { } challenge)
        {
            SecurityCookies.ClearPreauth(context);
            return ChallengeProblem(check.Status, messages);
        }

        var policy = await MfaPolicy.LoadAsync(db, cancellationToken);
        var methods = await AuthenticationFlow.ConfirmedMethodsAsync(db, challenge.UserId, cancellationToken);
        return Results.Ok(await AuthenticationFlow.DescribeAsync(
            db, context, challenge.User, challenge, methods, policy, cancellationToken));
    }

    private static async Task<IResult> CancelAsync(
        AppDbContext db,
        HttpContext context,
        CancellationToken cancellationToken)
    {
        if (SecurityCookies.ReadPreauth(context) is { } cookie)
        {
            var check = await AuthenticationFlow.ValidateAsync(
                db, context, cookie.Id.ToString(), purpose: null, cancellationToken);
            if (check.Challenge is { } challenge)
            {
                await AuthenticationFlow.ConsumeAsync(db, challenge.Id, cancellationToken);
            }
        }

        SecurityCookies.ClearPreauth(context);
        return Results.NoContent();
    }

    private static async Task<IResult> VerifyAsync(
        MfaVerifyRequest request,
        AppDbContext db,
        IDataProtectionProvider protection,
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

        if (request.UseTrustedDevice && challenge.Purpose != AuthChallengePurposes.Mfa)
        {
            return ChallengeProblem(ChallengeStatus.SecurityChanged, messages);
        }

        var recentFailures = await SecurityEvents.RecentMfaFailuresAsync(
            db, challenge.UserId, DateTime.UtcNow.AddMinutes(-15), cancellationToken);
        if (recentFailures >= 10)
        {
            return Results.Problem(
                statusCode: StatusCodes.Status429TooManyRequests,
                title: messages.Get(MessageKey.SecurityTooManyAttempts));
        }

        if (request.UseTrustedDevice)
        {
            var device = await TrustedDevices.FindAsync(db, challenge.UserId, context, cancellationToken);
            if (device is null)
            {
                await AuthenticationFlow.FailAttemptAsync(db, challenge, cancellationToken);
                return Results.Problem(
                    statusCode: StatusCodes.Status401Unauthorized,
                    title: messages.Get(MessageKey.SecurityCodeInvalid));
            }

            return await CompleteAsync(
                db, context, challenge, policy, messages, "trusted_device",
                fresh: false, rememberDevice: false, recoveryCodes: null,
                trustedDeviceId: device.Id, trustedDeviceTokenHash: device.TokenHash,
                cancellationToken: cancellationToken);
        }

        var code = request.Code?.Trim() ?? "";
        if (code.Length == 0)
        {
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["code"] = [messages.Get(MessageKey.SecurityCodeInvalid)] });
        }

        var evidence = "";
        Func<User, Task<bool>>? consumeProof = null;
        if (Guid.TryParse(request.MethodId, out var methodId))
        {
            var method = await db.MfaMethods.AsNoTracking()
                .SingleOrDefaultAsync(
                    x => x.Id == methodId &&
                        x.UserId == challenge.UserId &&
                        x.ConfirmedAt != null &&
                        x.RevokedAt == null,
                    cancellationToken);
            if (method is not null && method.Type == MfaMethodTypes.Totp)
            {
                evidence = MfaMethodTypes.Totp;
                consumeProof = async user =>
                {
                    var current = await db.MfaMethods.AsNoTracking()
                        .SingleOrDefaultAsync(
                            x => x.Id == methodId &&
                                x.UserId == user.Id &&
                                x.Type == MfaMethodTypes.Totp &&
                                x.ConfirmedAt != null &&
                                x.RevokedAt == null,
                            cancellationToken);
                    if (current is null ||
                        !MfaVerifier.TryVerifyTotpProof(protection, current, code, out var step))
                    {
                        return false;
                    }

                    return await MfaVerifier.ConsumeTotpStepAsync(
                        db, current.Id, user.Id, step, DateTime.UtcNow, allowPending: false, cancellationToken);
                };
            }
            else if (method is not null && method.Type == MfaMethodTypes.Email)
            {
                evidence = MfaMethodTypes.Email;
                var currentEmail = challenge.User.Email?.Trim();
                if (method.EmailAddress != challenge.User.NormalizedEmail ||
                    currentEmail is not { Length: > 0 })
                {
                    // Recheck inside the serializable completion transaction and
                    // only then revoke the stale address binding.
                    consumeProof = async user =>
                    {
                        var current = await db.MfaMethods.AsNoTracking()
                            .SingleOrDefaultAsync(
                                x => x.Id == methodId && x.UserId == user.Id,
                                cancellationToken);
                        if (current is not null &&
                            (current.EmailAddress != user.NormalizedEmail ||
                                user.Email?.Trim() is not { Length: > 0 }))
                        {
                            await db.MfaMethods
                                .Where(x => x.Id == methodId && x.UserId == user.Id && x.RevokedAt == null)
                                .ExecuteUpdateAsync(
                                    setters => setters.SetProperty(x => x.RevokedAt, DateTime.UtcNow),
                                    cancellationToken);
                            await db.EmailOtpCodes
                                .Where(x => x.UserId == user.Id && x.MethodId == methodId && x.ConsumedAt == null)
                                .ExecuteUpdateAsync(
                                    setters => setters.SetProperty(x => x.ConsumedAt, DateTime.UtcNow),
                                    cancellationToken);
                        }

                        return false;
                    };
                    return await CompleteAsync(
                        db, context, challenge, policy, messages, evidence,
                        fresh: true, request.RememberDevice, recoveryCodes: null, cancellationToken,
                        consumeProof: consumeProof);
                }

                consumeProof = async user =>
                {
                    var current = await db.MfaMethods.AsNoTracking()
                        .SingleOrDefaultAsync(
                            x => x.Id == methodId &&
                                x.UserId == user.Id &&
                                x.Type == MfaMethodTypes.Email &&
                                x.ConfirmedAt != null &&
                                x.RevokedAt == null &&
                                x.EmailAddress == user.NormalizedEmail,
                            cancellationToken);
                    var actual = user.Email?.Trim();
                    if (current is null || actual is not { Length: > 0 })
                    {
                        return false;
                    }

                    var proof = await EmailCodes.CheckAsync(
                        db, protection, user.Id, challenge.Id, EmailOtpPurposes.Login,
                        methodId, actual, code, cancellationToken);
                    return proof is not null &&
                        await EmailCodes.ConsumeAsync(db, proof, cancellationToken);
                };
            }
            else
            {
                return await FailedProofAsync(db, challenge, context, messages, "unknown", cancellationToken);
            }
        }
        else
        {
            evidence = "recovery";
            consumeProof = async user =>
                await MfaVerifier.ConsumeRecoveryCodeAsync(db, user.Id, code, cancellationToken);
        }

        return await CompleteAsync(
            db, context, challenge, policy, messages, evidence,
            fresh: true, request.RememberDevice, recoveryCodes: null, cancellationToken,
            consumeProof: consumeProof);
    }

    private static async Task<IResult> FailedProofAsync(
        AppDbContext db,
        AuthChallenge challenge,
        HttpContext context,
        Messages messages,
        string evidence,
        CancellationToken cancellationToken)
    {
        await AuthenticationFlow.FailAttemptAsync(db, challenge, cancellationToken);
        SecurityEvents.Record(
            db, challenge.UserId, SecurityEventKinds.MfaFailed, context, evidence);
        await db.SaveChangesAsync(cancellationToken);
        return Results.Problem(
            statusCode: StatusCodes.Status401Unauthorized,
            title: messages.Get(MessageKey.SecurityCodeInvalid));
    }

    private static async Task<IResult> SendEmailAsync(
        MfaEmailCodeRequest request,
        AppDbContext db,
        IDataProtectionProvider protection,
        IEmailDelivery delivery,
        IOptions<MailOptions> options,
        InstanceSecrets secrets,
        IConfiguration configuration,
        Messages messages,
        ILoggerFactory loggers,
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

        if (!Guid.TryParse(request.MethodId, out var methodId))
        {
            return MethodUnavailable(messages);
        }

        var method = await db.MfaMethods.AsNoTracking().SingleOrDefaultAsync(
            x => x.Id == methodId &&
                x.UserId == challenge.UserId &&
                x.Type == MfaMethodTypes.Email &&
                x.ConfirmedAt != null &&
                x.RevokedAt == null,
            cancellationToken);
        if (method?.EmailAddress is not { } address ||
            challenge.User.NormalizedEmail is not { } normalized ||
            address != normalized ||
            challenge.User.Email?.Trim() is not { Length: > 0 } recipient)
        {
            return MethodUnavailable(messages);
        }

        var outcome = await EmailCodes.SendAsync(
            db, configuration, options.Value, secrets, delivery, protection, messages,
            loggers.CreateLogger("Stellarr.Api.Security"), challenge.User, EmailOtpPurposes.Login,
            method.Id, challenge.Id, recipient, policy, cancellationToken);
        return EmailOutcome(outcome, recipient, messages, policy, context);
    }

    private static async Task<IResult> StartTotpAsync(
        MfaTotpStartRequest request,
        AppDbContext db,
        IDataProtectionProvider protection,
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

        var name = MethodName(request.Name, messages.Get(MessageKey.SecurityDefaultTotpName), messages);
        if (name is null)
        {
            return InvalidName(messages);
        }

        var secret = TotpService.NewSecret();
        var method = new MfaMethod
        {
            Id = Guid.NewGuid(),
            UserId = challenge.UserId,
            Type = MfaMethodTypes.Totp,
            Name = name,
            CreatedAt = DateTime.UtcNow,
        };
        method.ProtectedSecret = SecurityProtection.ProtectTotp(protection, method.UserId, method.Id, secret);
        db.MfaMethods.Add(method);
        await db.SaveChangesAsync(cancellationToken);

        return Results.Ok(new MfaEnrollmentDto(
            method.Id.ToString(),
            method.Type,
            secret,
            TotpService.OtpAuthUri("Stellarr", challenge.User.Username, secret)));
    }

    private static async Task<IResult> ConfirmTotpAsync(
        MfaTotpConfirmRequest request,
        AppDbContext db,
        IDataProtectionProvider protection,
        Messages messages,
        HttpContext context,
        CancellationToken cancellationToken)
    {
        var policy = await MfaPolicy.LoadAsync(db, cancellationToken);
        var check = await AuthenticationFlow.ValidateAsync(
            db, context, request.ChallengeId, purpose: null, cancellationToken);
        if (check.Challenge is not { } challenge || !IsEnrollmentPurpose(challenge.Purpose))
        {
            return ChallengeProblem(check.Status, messages);
        }

        if (!Guid.TryParse(request.MethodId, out var methodId))
        {
            return MethodUnavailable(messages);
        }

        var method = await db.MfaMethods.SingleOrDefaultAsync(
            x => x.Id == methodId &&
                x.UserId == challenge.UserId &&
                x.Type == MfaMethodTypes.Totp &&
                x.ConfirmedAt == null &&
                x.RevokedAt == null,
            cancellationToken);
        if (method is null)
        {
            return MethodUnavailable(messages);
        }

        var name = MethodName(request.Name, method.Name, messages);
        if (name is null)
        {
            return InvalidName(messages);
        }

        var recentFailures = await SecurityEvents.RecentMfaFailuresAsync(
            db, challenge.UserId, DateTime.UtcNow.AddMinutes(-15), cancellationToken);
        if (recentFailures >= 10)
        {
            return Results.Problem(
                statusCode: StatusCodes.Status429TooManyRequests,
                title: messages.Get(MessageKey.SecurityTooManyAttempts));
        }

        if (!MfaVerifier.TryVerifyTotpProof(protection, method, request.Code ?? "", out var step))
        {
            await AuthenticationFlow.FailAttemptAsync(db, challenge, cancellationToken);
            SecurityEvents.Record(
                db, challenge.UserId, SecurityEventKinds.MfaFailed, context, "totp-enrollment");
            await db.SaveChangesAsync(cancellationToken);
            return Results.Problem(
                statusCode: StatusCodes.Status401Unauthorized,
                title: messages.Get(MessageKey.SecurityCodeInvalid));
        }

        var now = DateTime.UtcNow;
        return await FinishEnrollmentAsync(
            db, context, challenge, messages, MfaMethodTypes.Totp, request.RememberDevice,
            notificationEmail: null,
            async user =>
            {
                var changed = await db.MfaMethods
                    .Where(x => x.Id == methodId &&
                        x.UserId == user.Id &&
                        x.Type == MfaMethodTypes.Totp &&
                        x.ConfirmedAt == null &&
                        x.RevokedAt == null &&
                        (x.LastTotpStep == null || x.LastTotpStep < step))
                    .ExecuteUpdateAsync(
                        setters => setters
                            .SetProperty(x => x.ConfirmedAt, now)
                            .SetProperty(x => x.Name, name)
                            .SetProperty(x => x.LastTotpStep, step)
                            .SetProperty(x => x.LastUsedAt, now),
                        cancellationToken);
                return changed == 1;
            },
            cancellationToken);
    }

    private static async Task<IResult> StartEmailAsync(
        MfaEmailStartRequest request,
        AppDbContext db,
        IDataProtectionProvider protection,
        IEmailDelivery delivery,
        IOptions<MailOptions> options,
        InstanceSecrets secrets,
        IConfiguration configuration,
        Messages messages,
        ILoggerFactory loggers,
        HttpContext context,
        CancellationToken cancellationToken)
    {
        var policy = await MfaPolicy.LoadAsync(db, cancellationToken);
        var check = await AuthenticationFlow.ValidateAsync(
            db, context, request.ChallengeId, purpose: null, cancellationToken);
        if (check.Challenge is not { } challenge || !IsEnrollmentPurpose(challenge.Purpose))
        {
            return ChallengeProblem(check.Status, messages);
        }

        if (challenge.User.NormalizedEmail is not { Length: > 0 } email ||
            challenge.User.Email?.Trim() is not { Length: > 0 } recipient)
        {
            return MethodUnavailable(messages);
        }

        var existing = await db.MfaMethods.AsNoTracking().AnyAsync(
            x => x.UserId == challenge.UserId &&
                x.Type == MfaMethodTypes.Email &&
                x.EmailAddress == email &&
                x.RevokedAt == null,
            cancellationToken);
        if (existing)
        {
            return MethodUnavailable(messages);
        }

        var outcome = await EmailCodes.SendAsync(
            db, configuration, options.Value, secrets, delivery, protection, messages,
            loggers.CreateLogger("Stellarr.Api.Security"), challenge.User, EmailOtpPurposes.Enrollment,
            methodId: null, challenge.Id, recipient, policy, cancellationToken);
        return EmailOutcome(outcome, recipient, messages, policy, context);
    }

    private static async Task<IResult> ConfirmEmailAsync(
        MfaEmailConfirmRequest request,
        AppDbContext db,
        IDataProtectionProvider protection,
        Messages messages,
        HttpContext context,
        CancellationToken cancellationToken)
    {
        var policy = await MfaPolicy.LoadAsync(db, cancellationToken);
        var check = await AuthenticationFlow.ValidateAsync(
            db, context, request.ChallengeId, purpose: null, cancellationToken);
        if (check.Challenge is not { } challenge || !IsEnrollmentPurpose(challenge.Purpose))
        {
            return ChallengeProblem(check.Status, messages);
        }

        if (challenge.User.NormalizedEmail is not { Length: > 0 } email ||
            challenge.User.Email?.Trim() is not { Length: > 0 } recipient)
        {
            return MethodUnavailable(messages);
        }

        var recentFailures = await SecurityEvents.RecentMfaFailuresAsync(
            db, challenge.UserId, DateTime.UtcNow.AddMinutes(-15), cancellationToken);
        if (recentFailures >= 10)
        {
            return Results.Problem(
                statusCode: StatusCodes.Status429TooManyRequests,
                title: messages.Get(MessageKey.SecurityTooManyAttempts));
        }

        var proof = await EmailCodes.CheckAsync(
            db, protection, challenge.UserId, challenge.Id, EmailOtpPurposes.Enrollment, null,
            recipient, request.Code ?? "", cancellationToken);
        if (proof is null)
        {
            await AuthenticationFlow.FailAttemptAsync(db, challenge, cancellationToken);
            SecurityEvents.Record(
                db, challenge.UserId, SecurityEventKinds.MfaFailed, context, "email-enrollment");
            await db.SaveChangesAsync(cancellationToken);
            return Results.Problem(
                statusCode: StatusCodes.Status401Unauthorized,
                title: messages.Get(MessageKey.SecurityCodeInvalid));
        }

        var name = MethodName(request.Name, messages.Get(MessageKey.SecurityDefaultEmailName), messages);
        if (name is null)
        {
            return InvalidName(messages);
        }

        return await FinishEnrollmentAsync(
            db, context, challenge, messages, MfaMethodTypes.Email, request.RememberDevice,
            notificationEmail: recipient,
            async user =>
            {
                if (user.NormalizedEmail != email ||
                    !string.Equals(user.Email?.Trim(), recipient, StringComparison.Ordinal))
                {
                    return false;
                }

                var existing = await db.MfaMethods.AnyAsync(
                    x => x.UserId == user.Id &&
                        x.Type == MfaMethodTypes.Email &&
                        x.EmailAddress == email &&
                        x.RevokedAt == null,
                    cancellationToken);
                if (existing || !await EmailCodes.ConsumeAsync(db, proof, cancellationToken))
                {
                    return false;
                }

                db.MfaMethods.Add(new MfaMethod
                {
                    Id = Guid.NewGuid(),
                    UserId = user.Id,
                    Type = MfaMethodTypes.Email,
                    Name = name,
                    CreatedAt = DateTime.UtcNow,
                    ConfirmedAt = DateTime.UtcNow,
                    LastUsedAt = DateTime.UtcNow,
                    EmailAddress = email,
                });
                return true;
            },
            cancellationToken);
    }

    /// <summary>
    /// Confirms one replacement/enrollment factor and creates the session in one
    /// serializable transition. The original challenge version is authoritative;
    /// a concurrent CLI reset makes this fail before any method or batch survives.
    /// </summary>
    private static async Task<IResult> FinishEnrollmentAsync(
        AppDbContext db,
        HttpContext context,
        AuthChallenge challenge,
        Messages messages,
        string methodType,
        bool rememberDevice,
        string? notificationEmail,
        Func<User, Task<bool>> confirmProof,
        CancellationToken cancellationToken)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(
            System.Data.IsolationLevel.Serializable, cancellationToken);
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"UPDATE \"Users\" SET \"SessionVersion\" = \"SessionVersion\" WHERE \"Id\" = {challenge.UserId};",
            cancellationToken);
        await db.Entry(challenge).ReloadAsync(cancellationToken);
        await db.Entry(challenge.User).ReloadAsync(cancellationToken);
        var user = challenge.User;
        if (challenge.ConsumedAt is not null ||
            challenge.ExpiresAt <= DateTime.UtcNow ||
            user.IsDisabled ||
            user.SessionVersion != challenge.SecurityVersion ||
            (user.SecurityRecoveryRequired && challenge.Purpose != AuthChallengePurposes.Recovery) ||
            (challenge.Purpose == AuthChallengePurposes.Recovery && !user.SecurityRecoveryRequired))
        {
            return ChallengeProblem(ChallengeStatus.SecurityChanged, messages);
        }

        if (challenge.ParentSessionId is { } parentSessionId)
        {
            var parentNow = DateTime.UtcNow;
            var legacyCutoff = parentNow - SessionAuthentication.Lifetime;
            var parentActive = await db.UserSessions.AsNoTracking().AnyAsync(
                x => x.Id == parentSessionId &&
                    x.UserId == user.Id &&
                    x.RevokedAt == null &&
                    x.ExpiresAt > parentNow &&
                    (x.AbsoluteExpiresAt > parentNow ||
                        (x.AbsoluteExpiresAt == null && x.CreatedAt > legacyCutoff)) &&
                    x.SecurityVersion == user.SessionVersion,
                cancellationToken);
            if (!parentActive)
            {
                return ChallengeProblem(ChallengeStatus.SecurityChanged, messages);
            }
        }

        if (!await confirmProof(user))
        {
            return ChallengeProblem(ChallengeStatus.SecurityChanged, messages);
        }

        if (!await AuthenticationFlow.ConsumeAsync(db, challenge.Id, cancellationToken))
        {
            return ChallengeProblem(ChallengeStatus.Consumed, messages);
        }

        var now = DateTime.UtcNow;
        user.SessionVersion++;
        if (challenge.Purpose == AuthChallengePurposes.Recovery)
        {
            user.SecurityRecoveryRequired = false;
        }

        var codes = await RecoveryCodes.RegenerateIfMissingAsync(db, user.Id, cancellationToken);
        DateTime? trustedExpiresAt = null;
        if (rememberDevice)
        {
            var policy = await MfaPolicy.LoadAsync(db, cancellationToken);
            var device = await TrustedDevices.IssueAsync(
                db, context, user.Id, policy, messages, cancellationToken);
            trustedExpiresAt = device.ExpiresAt;
            SecurityEvents.Record(
                db, user.Id, SecurityEventKinds.TrustedDeviceAdded, context, device.Name);
        }

        SecurityEvents.Record(
            db, user.Id, SecurityEventKinds.MethodAdded, context, methodType,
            notificationEmail ?? await SecurityEvents.VerifiedEmailAsync(db, user.Id, cancellationToken));
        var session = SessionAuthentication.CreateSession(
            context, user.Id, messages, challenge.PrimarySource, now, methodType, user.SessionVersion);
        db.UserSessions.Add(session);
        SecurityEvents.Record(
            db, user.Id, SecurityEventKinds.MfaSucceeded, context, methodType,
            notificationEmail ?? await SecurityEvents.VerifiedEmailAsync(db, user.Id, cancellationToken));
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        await SessionAuthentication.SignInAsync(context, user, session.Id);
        SecurityCookies.ClearPreauth(context);
        return Results.Ok(new MfaCompleteDto("ok", user.ToDto("online"), codes, trustedExpiresAt));
    }

    private static Task<IResult> CompleteAsync(
        AppDbContext db,
        HttpContext context,
        AuthChallenge challenge,
        SecurityPolicy policy,
        Messages messages,
        string evidence,
        bool fresh,
        bool rememberDevice,
        IReadOnlyList<string>? recoveryCodes,
        CancellationToken cancellationToken,
        Guid? trustedDeviceId = null,
        string? trustedDeviceTokenHash = null,
        Func<User, Task<bool>>? consumeProof = null) =>
        FinishAsync(
            db, context, challenge, policy, messages, evidence,
            rememberDevice, recoveryCodes, cancellationToken,
            fresh: fresh, expectedVersion: challenge.SecurityVersion,
            trustedDeviceId: trustedDeviceId, trustedDeviceTokenHash: trustedDeviceTokenHash,
            consumeProof: consumeProof, failureEvidence: evidence);

    private static async Task<IResult> FinishAsync(
        AppDbContext db,
        HttpContext context,
        AuthChallenge challenge,
        SecurityPolicy policy,
        Messages messages,
        string evidence,
        bool rememberDevice,
        IReadOnlyList<string>? recoveryCodes,
        CancellationToken cancellationToken,
        bool fresh = true,
        int? expectedVersion = null,
        Guid? trustedDeviceId = null,
        string? trustedDeviceTokenHash = null,
        Func<User, Task<bool>>? consumeProof = null,
        string failureEvidence = "")
    {
        await using var transaction = await db.Database.BeginTransactionAsync(
            System.Data.IsolationLevel.Serializable, cancellationToken);
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"UPDATE \"Users\" SET \"SessionVersion\" = \"SessionVersion\" WHERE \"Id\" = {challenge.UserId};",
            cancellationToken);
        await db.Entry(challenge).ReloadAsync(cancellationToken);
        await db.Entry(challenge.User).ReloadAsync(cancellationToken);
        var user = challenge.User;
        var version = expectedVersion ?? challenge.SecurityVersion;
        if (challenge.ConsumedAt is not null ||
            challenge.ExpiresAt <= DateTime.UtcNow ||
            user.IsDisabled ||
            user.SessionVersion != version ||
            (user.SecurityRecoveryRequired && challenge.Purpose != AuthChallengePurposes.Recovery) ||
            (challenge.Purpose == AuthChallengePurposes.Recovery && !user.SecurityRecoveryRequired))
        {
            return ChallengeProblem(ChallengeStatus.SecurityChanged, messages);
        }

        var recentFailures = await SecurityEvents.RecentMfaFailuresAsync(
            db, user.Id, DateTime.UtcNow.AddMinutes(-15), cancellationToken);
        if (recentFailures >= 10)
        {
            return Results.Problem(
                statusCode: StatusCodes.Status429TooManyRequests,
                title: messages.Get(MessageKey.SecurityTooManyAttempts));
        }

        if (consumeProof is not null && !await consumeProof(user))
        {
            await AuthenticationFlow.FailAttemptAsync(db, challenge, cancellationToken);
            SecurityEvents.Record(
                db, user.Id, SecurityEventKinds.MfaFailed, context,
                failureEvidence.Length == 0 ? "unknown" : failureEvidence);
            await db.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return Results.Problem(
                statusCode: StatusCodes.Status401Unauthorized,
                title: messages.Get(MessageKey.SecurityCodeInvalid));
        }

        if (!await AuthenticationFlow.ConsumeAsync(db, challenge.Id, cancellationToken))
        {
            return ChallengeProblem(ChallengeStatus.Consumed, messages);
        }

        var authoritativePolicy = await MfaPolicy.LoadAsync(db, cancellationToken);
        var required = await MfaPolicy.IsRequiredAtLoginAsync(
            db, authoritativePolicy, user.Id, cancellationToken);
        if (required && !MfaPolicy.IsSatisfied(fresh, evidence, authoritativePolicy.MfaRequirement))
        {
            return ChallengeProblem(ChallengeStatus.SecurityChanged, messages);
        }

        if (trustedDeviceId is { } trustedId)
        {
            var nowTrust = DateTime.UtcNow;
            var activeTrust = await db.TrustedDevices.AnyAsync(
                x => x.Id == trustedId &&
                    x.UserId == user.Id &&
                    x.TokenHash == trustedDeviceTokenHash &&
                    x.RevokedAt == null &&
                    x.ExpiresAt > nowTrust,
                cancellationToken);
            if (!activeTrust)
            {
                return ChallengeProblem(ChallengeStatus.SecurityChanged, messages);
            }

            await db.TrustedDevices
                .Where(x => x.Id == trustedId && x.UserId == user.Id && x.RevokedAt == null)
                .ExecuteUpdateAsync(setters => setters.SetProperty(x => x.LastUsedAt, nowTrust), cancellationToken);
        }

        if (challenge.ParentSessionId is { } parentSessionId)
        {
            var parentNow = DateTime.UtcNow;
            var legacyCutoff = parentNow - SessionAuthentication.Lifetime;
            var parentActive = await db.UserSessions.AsNoTracking().AnyAsync(
                x => x.Id == parentSessionId &&
                    x.UserId == user.Id &&
                    x.RevokedAt == null &&
                    x.ExpiresAt > parentNow &&
                    (x.AbsoluteExpiresAt > parentNow ||
                        (x.AbsoluteExpiresAt == null && x.CreatedAt > legacyCutoff)) &&
                    x.SecurityVersion == user.SessionVersion,
                cancellationToken);
            if (!parentActive)
            {
                return ChallengeProblem(ChallengeStatus.SecurityChanged, messages);
            }
        }

        var now = DateTime.UtcNow;
        DateTime? trustedExpiresAt = null;
        if (rememberDevice)
        {
            var device = await TrustedDevices.IssueAsync(
                db, context, user.Id, authoritativePolicy, messages, cancellationToken);
            trustedExpiresAt = device.ExpiresAt;
            SecurityEvents.Record(
                db, user.Id, SecurityEventKinds.TrustedDeviceAdded, context, device.Name);
        }

        if (challenge.Purpose == AuthChallengePurposes.Recovery)
        {
            user.SecurityRecoveryRequired = false;
        }

        var codes = recoveryCodes;
        var session = SessionAuthentication.CreateSession(
            context,
            user.Id,
            messages,
            challenge.PrimarySource,
            fresh ? now : null,
            evidence,
            user.SessionVersion);
        db.UserSessions.Add(session);

        var kind = evidence == "recovery"
            ? SecurityEventKinds.RecoveryCodeUsed
            : SecurityEventKinds.MfaSucceeded;
        SecurityEvents.Record(
            db, user.Id, kind, context, evidence,
            await SecurityEvents.VerifiedEmailAsync(db, user.Id, cancellationToken));
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        await SessionAuthentication.SignInAsync(context, user, session.Id);
        SecurityCookies.ClearPreauth(context);
        return Results.Ok(new MfaCompleteDto(
            "ok",
            user.ToDto("online"),
            codes,
            trustedExpiresAt));
    }

    private static bool IsEnrollmentPurpose(string purpose) =>
        purpose is AuthChallengePurposes.Enrollment or AuthChallengePurposes.Recovery;

    private static string? MethodName(string? requested, string fallback, Messages messages)
    {
        var name = (requested ?? "").Trim();
        if (name.Length == 0)
        {
            return fallback;
        }

        return name.Length <= 64 ? name : null;
    }

    private static IResult MethodUnavailable(Messages messages) => Results.Problem(
        statusCode: StatusCodes.Status409Conflict,
        title: messages.Get(MessageKey.SecurityMethodUnavailable));

    private static IResult InvalidName(Messages messages) => Results.ValidationProblem(
        new Dictionary<string, string[]> { ["name"] = [messages.Get(MessageKey.SecurityMethodNameInvalid)] });

    private static IResult EmailOutcome(
        EmailCodeSendOutcome outcome,
        string address,
        Messages messages,
        SecurityPolicy policy,
        HttpContext context) =>
        outcome.Result switch
        {
            EmailCodeSendResult.Sent => Results.Ok(new
            {
                status = "sent",
                message = messages.Get(MessageKey.SecurityEmailCodeSent, ("email", address)),
                retryAfterSeconds = (int)policy.EmailCooldown.TotalSeconds,
            }),
            EmailCodeSendResult.Cooldown => Retry(
                context,
                outcome.RetryAfterSeconds,
                Results.Problem(
                    statusCode: StatusCodes.Status429TooManyRequests,
                    title: messages.Get(MessageKey.SecurityEmailCooldown, ("seconds", outcome.RetryAfterSeconds)),
                    extensions: new Dictionary<string, object?>
                    {
                        ["retryAfterSeconds"] = outcome.RetryAfterSeconds,
                    })),
            EmailCodeSendResult.Limit => Retry(
                context,
                3600,
                Results.Problem(
                    statusCode: StatusCodes.Status429TooManyRequests,
                    title: messages.Get(MessageKey.SecurityEmailSendLimit),
                    extensions: new Dictionary<string, object?> { ["retryAfterSeconds"] = 3600 })),
            EmailCodeSendResult.DeliveryFailed => Results.Problem(
                statusCode: StatusCodes.Status502BadGateway,
                title: messages.Get(MessageKey.SecurityDeliveryFailed)),
            _ => Results.Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: messages.Get(MessageKey.SecurityEmailUnavailable)),
        };

    private static IResult Retry(HttpContext context, int seconds, IResult result)
    {
        context.Response.Headers.RetryAfter = seconds.ToString(System.Globalization.CultureInfo.InvariantCulture);
        return result;
    }

    public static IResult ChallengeProblem(ChallengeStatus status, Messages messages) => status switch
    {
        ChallengeStatus.AttemptLimit => Results.Problem(
            statusCode: StatusCodes.Status429TooManyRequests,
            title: messages.Get(MessageKey.SecurityTooManyAttempts)),
        _ => Results.Problem(
            statusCode: StatusCodes.Status401Unauthorized,
            title: messages.Get(MessageKey.SecurityChallengeInvalid)),
    };
}
