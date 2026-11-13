using Stellarr.Api.Auth;
using Stellarr.Api.Data;
using Stellarr.Api.Integrations.Cloudflare;
using Stellarr.Api.Localization;
using Stellarr.Api.Secrets;

namespace Stellarr.Api.Endpoints;

public static partial class CockpitEndpoints
{
    private static async Task<IResult> GetCloudflareR2Async(CloudflareR2PolicyStore policies) =>
        Results.Ok(CloudflareR2Of(policies.Current, policies.Source));

    private static async Task<IResult> UpdateCloudflareR2Async(CloudflareR2Request request,
        HttpContext http, AppDbContext db, CloudflareR2PolicyStore policies, InstanceSecrets secrets,
        Messages messages, CancellationToken cancellationToken)
    {
        var problems = new Dictionary<string, string[]>();
        if (request.Mode is null || request.Endpoint is null || request.Region is null ||
            request.Bucket is null || request.Prefix is null ||
            request.Mode.Length > 16 || request.Endpoint.Length > 2048 || request.Region.Length > 100 ||
            request.Bucket.Length > 255 || request.Prefix.Length > 512 ||
            !CloudflareR2Modes.IsKnown(request.Mode))
            problems["settings"] = [messages.Get(MessageKey.CockpitCloudflareR2FieldsInvalid)];
        if (problems.Count > 0) return Results.ValidationProblem(problems);

        var policy = CloudflareR2PolicyStore.FromRequest(request);
        var resolved = await secrets.ReadAsync(cancellationToken);
        var missingCredentials = policy.Mode switch
        {
            CloudflareR2Modes.S3 => !resolved[SecretNames.CloudflareR2AccessKey].IsSet ||
                !resolved[SecretNames.CloudflareR2SecretKey].IsSet,
            CloudflareR2Modes.Worker => !resolved[SecretNames.CloudflareR2WorkerToken].IsSet,
            _ => true,
        };
        if (policy.Enabled && (!policy.IsValid(requireCredentials: false) || missingCredentials))
            problems["destination"] = [messages.Get(MessageKey.CockpitCloudflareR2Invalid)];
        if (problems.Count > 0) return Results.ValidationProblem(problems);

        var server = http.RequireInstanceServer();
        await policies.StageAsync(db, policy, cancellationToken);
        await StageAuditAsync(db, server.Id, http.User.RequireUserId(), messages.Get(MessageKey.AuditSettingsUpdated), cancellationToken);
        if (!await db.TrySaveChangesAsync(cancellationToken)) return Results.Conflict();
        policies.Publish(policy);
        return Results.Ok(CloudflareR2Of(policy, policies.Source));
    }

    private static async Task<IResult> ResetCloudflareR2Async(HttpContext http, AppDbContext db,
        CloudflareR2PolicyStore policies, Messages messages, CancellationToken cancellationToken)
    {
        var server = http.RequireInstanceServer();
        await policies.StageResetAsync(db, cancellationToken);
        await StageAuditAsync(db, server.Id, http.User.RequireUserId(), messages.Get(MessageKey.AuditSettingsUpdated), cancellationToken);
        if (!await db.TrySaveChangesAsync(cancellationToken)) return Results.Conflict();
        policies.Reset();
        return Results.Ok(CloudflareR2Of(policies.Current, policies.Source));
    }

    private static CloudflareR2Dto CloudflareR2Of(CloudflareR2Options settings, string source) => new(
        settings.Enabled, settings.Mode, settings.Endpoint, settings.Region,
        settings.Bucket, settings.Prefix, source);
}
