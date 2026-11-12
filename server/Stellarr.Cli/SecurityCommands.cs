using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Auth.Security;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;
using Stellarr.Api.Operations;

namespace Stellarr.Cli;

internal static class SecurityCommands
{
    private const int MaxEvents = 100;

    internal static async Task<CliResult> ShowAsync(
        CliRuntime runtime,
        string idOrUsername,
        CancellationToken cancellationToken)
    {
        await using var database = await runtime.OpenDatabaseAsync(mutation: false, cancellationToken);
        var db = database.Context;
        var user = await CommandSupport.ResolveUserAsync(db, idOrUsername, cancellationToken);
        var now = DateTime.UtcNow;
        var methods = await db.MfaMethods.AsNoTracking()
            .Where(x => x.UserId == user.Id && x.RevokedAt == null)
            .OrderBy(x => x.CreatedAt)
            .ToArrayAsync(cancellationToken);
        var devices = await db.TrustedDevices.AsNoTracking()
            .Where(x => x.UserId == user.Id && x.RevokedAt == null && x.ExpiresAt > now)
            .OrderByDescending(x => x.CreatedAt)
            .ToArrayAsync(cancellationToken);
        var sessions = await db.UserSessions.AsNoTracking()
            .Where(x => x.UserId == user.Id && x.RevokedAt == null && x.ExpiresAt > now)
            .OrderByDescending(x => x.LastSeenAt)
            .ToArrayAsync(cancellationToken);
        var remainingCodes = await db.RecoveryCodes.AsNoTracking()
            .CountAsync(x => x.UserId == user.Id && x.UsedAt == null, cancellationToken);
        var events = await db.SecurityEvents.AsNoTracking()
            .Where(x => x.UserId == user.Id)
            .OrderByDescending(x => x.CreatedAt)
            .Take(MaxEvents)
            .ToArrayAsync(cancellationToken);
        var settings = await InstanceSettingsService.LoadAsync(
            db, await CommandSupport.RequireInstanceServerAsync(db, cancellationToken),
            runtime.Configuration, cancellationToken);
        var policy = SecurityPolicy.From(settings);

        var data = new
        {
            userId = user.Id.ToString(),
            username = user.Username,
            displayName = user.DisplayName,
            disabled = user.IsDisabled,
            securityRecoveryRequired = user.SecurityRecoveryRequired,
            sessionVersion = user.SessionVersion,
            policy = new
            {
                mfaRequirement = policy.MfaRequirement,
                trustedDeviceDays = policy.TrustedDeviceDays,
                challengeMinutes = policy.AuthChallengeMinutes,
                emailCodeMinutes = policy.EmailCodeMinutes,
                emailCodeCooldownSeconds = policy.EmailCodeCooldownSeconds,
                emailCodeMaxAttempts = policy.EmailCodeMaxAttempts,
                emailCodeSendsPerHour = policy.EmailCodeSendsPerHour,
                cliRecoveryMinutes = policy.CliRecoveryMinutes,
            },
            methods = methods.Select(method => new
            {
                id = method.Id.ToString(),
                type = method.Type,
                name = method.Name,
                confirmed = method.ConfirmedAt is not null,
                lastUsedAt = method.LastUsedAt,
                email = method.Type == MfaMethodTypes.Email ? method.EmailAddress : null,
            }).ToArray(),
            trustedDevices = devices.Select(device => new
            {
                id = device.Id.ToString(),
                name = device.Name,
                device = device.Device,
                createdAt = device.CreatedAt,
                expiresAt = device.ExpiresAt,
                lastUsedAt = device.LastUsedAt,
            }).ToArray(),
            sessions = sessions.Select(session => new
            {
                id = session.Id.ToString(),
                device = session.Device,
                ipAddress = session.IpAddress,
                createdAt = session.CreatedAt,
                lastSeenAt = session.LastSeenAt,
                expiresAt = session.ExpiresAt,
            }).ToArray(),
            remainingRecoveryCodes = remainingCodes,
            events = events.Select(securityEvent => new
            {
                kind = securityEvent.Kind,
                detail = securityEvent.Detail,
                ipAddress = securityEvent.IpAddress,
                device = securityEvent.Device,
                createdAt = securityEvent.CreatedAt,
            }).ToArray(),
        };

        var lines = new List<string>
        {
            $"Account: {user.Username} ({user.DisplayName}) [{user.Id}]",
            $"Disabled: {(user.IsDisabled ? "yes" : "no")}",
            $"Recovery required: {(user.SecurityRecoveryRequired ? "yes" : "no")}",
            $"MFA requirement: {policy.MfaRequirement}",
            $"Security methods: {methods.Length}",
        };
        lines.AddRange(methods.Select(method =>
            $"  {method.Id}  {method.Type}  {method.Name}  " +
            $"{(method.ConfirmedAt is null ? "pending" : "confirmed")}  " +
            $"last used {(method.LastUsedAt is { } used ? used.ToString("O") : "(never)")}" +
            (method.Type == MfaMethodTypes.Email ? $"  {method.EmailAddress}" : "")));
        lines.Add($"Trusted devices: {devices.Length}");
        lines.Add($"Active sessions: {sessions.Length}");
        lines.Add($"Unused recovery codes: {remainingCodes}");
        lines.Add($"Recent security events: {events.Length}");
        return new CliResult("security.show", data, lines);
    }

    internal static async Task<CliResult> MethodsAsync(
        CliRuntime runtime,
        string idOrUsername,
        CancellationToken cancellationToken)
    {
        var shown = await ShowAsync(runtime, idOrUsername, cancellationToken);
        return shown with { Command = "security.methods" };
    }

    internal static async Task<CliResult> RecoverAsync(
        CliRuntime runtime,
        string idOrUsername,
        string reason,
        CancellationToken cancellationToken)
    {
        var trimmedReason = reason.Trim();
        if (trimmedReason.Length is < 3 or > 500)
        {
            throw new CliException(
                "invalid_reason",
                "A recovery reason must be 3 to 500 characters long.",
                CliExit.Usage);
        }

        await using var database = await runtime.OpenDatabaseAsync(mutation: true, cancellationToken);
        var db = database.Context;
        var server = await CommandSupport.RequireInstanceServerAsync(db, cancellationToken);
        var requestedId = Guid.TryParse(idOrUsername.Trim(), out var parsed) ? parsed : (Guid?)null;
        var normalized = idOrUsername.Trim().ToUpperInvariant();
        var user = (requestedId is { } id
            ? await db.Users.SingleOrDefaultAsync(x => x.Id == id, cancellationToken)
            : await db.Users.SingleOrDefaultAsync(
                x => x.NormalizedUsername == normalized,
                cancellationToken)) ?? throw CommandSupport.UserNotFound(idOrUsername);
        if (user.IsDisabled)
        {
            throw new CliException(
                "account_disabled",
                "The account is disabled. Enable it before recovering its security methods.",
                CliExit.Conflict);
        }

        var settings = await InstanceSettingsService.LoadAsync(
            db, server, runtime.Configuration, cancellationToken);
        var policy = SecurityPolicy.From(settings);
        // A confirmation may wait for a person while another process writes the
        // settings row; this command only reads policy values and must not race
        // an insert of a second row keyed by the same instance server.
        db.Entry(settings).State = Microsoft.EntityFrameworkCore.EntityState.Detached;
        var previewNow = DateTime.UtcNow;
        var verifiedEmailMethod = user.NormalizedEmail is { Length: > 0 } normalizedEmail
            ? await db.MfaMethods.AsNoTracking().FirstOrDefaultAsync(
                x => x.UserId == user.Id &&
                    x.Type == MfaMethodTypes.Email &&
                    x.ConfirmedAt != null &&
                    x.RevokedAt == null &&
                    x.EmailAddress == normalizedEmail,
                cancellationToken)
            : null;
        var alertRecipient = verifiedEmailMethod is null ? null : user.Email?.Trim();
        var methods = await db.MfaMethods.AsNoTracking()
            .CountAsync(x => x.UserId == user.Id && x.RevokedAt == null, cancellationToken);
        var devices = await db.TrustedDevices.AsNoTracking()
            .CountAsync(x => x.UserId == user.Id && x.RevokedAt == null, cancellationToken);
        var sessions = await db.UserSessions.AsNoTracking()
            .CountAsync(x => x.UserId == user.Id && x.RevokedAt == null && x.ExpiresAt > previewNow, cancellationToken);
        var handoffs = await db.DesktopBrowserLogins.AsNoTracking()
            .CountAsync(x => x.UserId == user.Id && x.ApprovedAt != null && x.RedeemedAt == null, cancellationToken);

        runtime.Confirm(
            $"Will revoke {methods} security method(s), {devices} trusted device(s), " +
            $"{sessions} active session(s) and {handoffs} approved desktop handoff(s) of " +
            $"{user.DisplayName} ({user.Username}), then issue one recovery credential valid for " +
            $"{policy.CliRecoveryMinutes} minutes. Reason: {trimmedReason}");

        await using var transaction = await db.Database.BeginTransactionAsync(
            System.Data.IsolationLevel.Serializable, cancellationToken);
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"UPDATE \"Users\" SET \"SessionVersion\" = \"SessionVersion\" WHERE \"Id\" = {user.Id};",
            cancellationToken);
        await db.Entry(user).ReloadAsync(cancellationToken);
        if (user.IsDisabled)
        {
            throw new CliException(
                "account_disabled",
                "The account is disabled. Enable it before recovering its security methods.",
                CliExit.Conflict);
        }

        var now = DateTime.UtcNow;
        verifiedEmailMethod = user.NormalizedEmail is { Length: > 0 } currentNormalized
            ? await db.MfaMethods.AsNoTracking().FirstOrDefaultAsync(
                x => x.UserId == user.Id &&
                    x.Type == MfaMethodTypes.Email &&
                    x.ConfirmedAt != null &&
                    x.RevokedAt == null &&
                    x.EmailAddress == currentNormalized,
                cancellationToken)
            : null;
        alertRecipient = verifiedEmailMethod is null ? null : user.Email?.Trim();
        methods = await db.MfaMethods.AsNoTracking()
            .CountAsync(x => x.UserId == user.Id && x.RevokedAt == null, cancellationToken);
        devices = await db.TrustedDevices.AsNoTracking()
            .CountAsync(x => x.UserId == user.Id && x.RevokedAt == null, cancellationToken);
        sessions = await db.UserSessions.AsNoTracking()
            .CountAsync(x => x.UserId == user.Id && x.RevokedAt == null && x.ExpiresAt > now, cancellationToken);
        handoffs = await db.DesktopBrowserLogins.AsNoTracking()
            .CountAsync(x => x.UserId == user.Id && x.ApprovedAt != null && x.RedeemedAt == null, cancellationToken);

        await db.MfaMethods
            .Where(x => x.UserId == user.Id && x.RevokedAt == null)
            .ExecuteUpdateAsync(setters => setters.SetProperty(x => x.RevokedAt, now), cancellationToken);
        await db.TrustedDevices
            .Where(x => x.UserId == user.Id && x.RevokedAt == null)
            .ExecuteUpdateAsync(setters => setters.SetProperty(x => x.RevokedAt, now), cancellationToken);
        await db.UserSessions
            .Where(x => x.UserId == user.Id && x.RevokedAt == null)
            .ExecuteUpdateAsync(setters => setters.SetProperty(x => x.RevokedAt, now), cancellationToken);
        await db.DesktopBrowserLogins
            .Where(x => x.UserId == user.Id && x.ApprovedAt != null && x.RedeemedAt == null)
            .ExecuteUpdateAsync(setters => setters.SetProperty(x => x.RedeemedAt, now), cancellationToken);
        await db.RecoveryCodes
            .Where(x => x.UserId == user.Id && x.UsedAt == null)
            .ExecuteUpdateAsync(setters => setters.SetProperty(x => x.UsedAt, now), cancellationToken);
        await db.CliRecoveryCredentials
            .Where(x => x.UserId == user.Id && x.UsedAt == null)
            .ExecuteUpdateAsync(setters => setters.SetProperty(x => x.UsedAt, now), cancellationToken);

        user.SessionVersion++;
        user.SecurityRecoveryRequired = true;
        var credential = SecurityTokens.Random(32);
        var recovery = new CliRecoveryCredential
        {
            Id = Guid.NewGuid(),
            UserId = user.Id,
            TokenHash = SecurityTokens.Hash(credential),
            Reason = trimmedReason,
            SecurityVersion = user.SessionVersion,
            CreatedAt = now,
            ExpiresAt = now + policy.CliRecoveryLifetime,
        };
        db.CliRecoveryCredentials.Add(recovery);
        SecurityEvents.Record(
            db, user.Id, SecurityEventKinds.CliRecovery, null,
            $"operator recovery: {trimmedReason}", alertRecipient);
        db.OperatorAuditEntries.Add(CliDatabase.Audit("security.recover", user.Id.ToString()));
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        return new CliResult(
            "security.recover",
            new
            {
                userId = user.Id.ToString(),
                username = user.Username,
                methodsRevoked = methods,
                trustedDevicesRevoked = devices,
                sessionsRevoked = sessions,
                handoffsInvalidated = handoffs,
                recoveryCredential = credential,
                recoveryExpiresAt = recovery.ExpiresAt,
                sessionVersion = user.SessionVersion,
                securityRecoveryRequired = true,
                auditActor = "local-cli",
            },
            [
                $"Recovered the account security of {user.DisplayName} ({user.Username}).",
                $"Revoked {methods} method(s), {devices} trusted device(s), {sessions} session(s) and {handoffs} handoff(s).",
                "Ordinary password, OIDC and desktop sign-in remain blocked until replacement security is enrolled.",
                $"Recovery credential (shown once, valid until {recovery.ExpiresAt:O}):",
                credential,
                "Exchange it through POST /api/auth/recovery/redeem; it can only enroll replacement security.",
                "Audit: local-cli security.recover " + user.Id,
            ]);
    }
}
