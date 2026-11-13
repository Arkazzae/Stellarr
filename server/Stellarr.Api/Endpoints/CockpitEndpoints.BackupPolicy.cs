using System.ComponentModel.DataAnnotations;
using Stellarr.Api.Auth;
using Stellarr.Api.Backups;
using Stellarr.Api.Data;
using Stellarr.Api.Localization;
using Stellarr.Api.Operations;
using Stellarr.Api.Secrets;

namespace Stellarr.Api.Endpoints;

public static partial class CockpitEndpoints
{
    private static async Task<IResult> GetBackupPolicyAsync(HttpContext http, AppDbContext db,
        IConfiguration configuration, BackupPolicyStore policies, CancellationToken cancellationToken)
    {
        var settings = await InstanceSettingsService.LoadAsync(db, http.RequireInstanceServer(), configuration, cancellationToken);
        return Results.Ok(BackupPolicyOf(policies, settings.BackupRetentionDays, settings.AutomaticCleanupEnabled));
    }

    private static async Task<IResult> UpdateBackupPolicyAsync(BackupPolicyRequest request,
        HttpContext http, AppDbContext db, IConfiguration configuration, BackupPolicyStore policies,
        InstanceSecrets secrets, Messages messages, CancellationToken cancellationToken)
    {
        var problems = new Dictionary<string, string[]>();
        if (request.Endpoint is null || request.Region is null || request.Bucket is null || request.Prefix is null ||
            request.Endpoint.Length > 2048 || request.Region.Length > 100 || request.Bucket.Length > 255 || request.Prefix.Length > 512)
            problems["destination"] = [messages.Get(MessageKey.CockpitBackupPolicyFieldsInvalid)];
        if (problems.Count > 0) return Results.ValidationProblem(problems);
        var policy = BackupPolicyStore.FromRequest(request);
        var validations = new List<ValidationResult>();
        Validator.TryValidateObject(policy, new ValidationContext(policy), validations, validateAllProperties: true);
        foreach (var result in validations)
            foreach (var member in result.MemberNames) problems[member] = [result.ErrorMessage!];
        if (request.RetentionDays is < 1 or > InstanceSettingsService.MaxRetentionDays)
            problems["retentionDays"] = [messages.Get(MessageKey.CockpitBackupRetentionRange, ("max", InstanceSettingsService.MaxRetentionDays))];
        var resolved = await secrets.ReadAsync(cancellationToken);
        if (policy.Destination.Enabled && (!policy.Destination.IsValid(requireCredentials: false) ||
            !resolved[SecretNames.BackupAccessKey].IsSet || !resolved[SecretNames.BackupSecretKey].IsSet))
            problems["destination"] = [messages.Get(MessageKey.CockpitBackupPolicyDestinationInvalid)];
        if (problems.Count > 0) return Results.ValidationProblem(problems);

        var server = http.RequireInstanceServer();
        var settings = await InstanceSettingsService.LoadAsync(db, server, configuration, cancellationToken);
        settings.BackupRetentionDays = request.RetentionDays;
        settings.UpdatedAt = DateTime.UtcNow;
        await policies.StageAsync(db, policy, cancellationToken);
        await StageAuditAsync(db, server.Id, http.User.RequireUserId(), messages.Get(MessageKey.AuditSettingsUpdated), cancellationToken);
        if (!await db.TrySaveChangesAsync(cancellationToken)) return Results.Conflict();
        policies.Publish(policy);
        return Results.Ok(BackupPolicyOf(policies, settings.BackupRetentionDays, settings.AutomaticCleanupEnabled));
    }

    private static BackupPolicyDto BackupPolicyOf(BackupPolicyStore policies, int retentionDays, bool cleanupEnabled)
    {
        var policy = policies.Current;
        return new(policy.Enabled, policy.IntervalHours, policy.RetryMinutes, policy.InitialDelayMinutes,
            policy.Destination.Enabled, policy.Destination.Endpoint, policy.Destination.Region,
            policy.Destination.Bucket, policy.Destination.Prefix, retentionDays, cleanupEnabled, policies.Source);
    }

    private static async Task<IResult> ResetBackupPolicyAsync(HttpContext http, AppDbContext db,
        IConfiguration configuration, BackupPolicyStore policies, Messages messages, CancellationToken cancellationToken)
    {
        var server = http.RequireInstanceServer();
        await policies.StageResetAsync(db, cancellationToken);
        await StageAuditAsync(db, server.Id, http.User.RequireUserId(), messages.Get(MessageKey.AuditSettingsUpdated), cancellationToken);
        if (!await db.TrySaveChangesAsync(cancellationToken)) return Results.Conflict();
        policies.Reset();
        var settings = await InstanceSettingsService.LoadAsync(db, server, configuration, cancellationToken);
        return Results.Ok(BackupPolicyOf(policies, settings.BackupRetentionDays, settings.AutomaticCleanupEnabled));
    }
}
