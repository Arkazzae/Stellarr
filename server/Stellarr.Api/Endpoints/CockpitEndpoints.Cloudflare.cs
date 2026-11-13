using Stellarr.Api.Auth;
using Stellarr.Api.Data;
using Stellarr.Api.Integrations.Cloudflare;
using Stellarr.Api.Localization;
using Stellarr.Api.Secrets;

namespace Stellarr.Api.Endpoints;

public static partial class CockpitEndpoints
{
    private static async Task<IResult> GetCloudflareR2Async(CloudflareR2PolicyStore policies)
    {
        var settings = policies.Current;
        return Results.Ok(new CloudflareR2Dto(
            settings.Enabled, settings.Endpoint, settings.Region, settings.Bucket, settings.Prefix, policies.Source));
    }

    private static async Task<IResult> UpdateCloudflareR2Async(CloudflareR2Request request,
        HttpContext http, AppDbContext db, CloudflareR2PolicyStore policies, InstanceSecrets secrets,
        Messages messages, CancellationToken cancellationToken)
    {
        var problems = new Dictionary<string, string[]>();
        if (request.Endpoint is null || request.Region is null || request.Bucket is null || request.Prefix is null ||
            request.Endpoint.Length > 2048 || request.Region.Length > 100 || request.Bucket.Length > 255 || request.Prefix.Length > 512)
            problems["settings"] = [messages.Get(MessageKey.CockpitCloudflareR2FieldsInvalid)];
        if (problems.Count > 0) return Results.ValidationProblem(problems);

        var policy = CloudflareR2PolicyStore.FromRequest(request);
        var resolved = await secrets.ReadAsync(cancellationToken);
        if (policy.Enabled && (!policy.IsValid(requireCredentials: false) ||
            !resolved[SecretNames.CloudflareR2AccessKey].IsSet || !resolved[SecretNames.CloudflareR2SecretKey].IsSet))
            problems["destination"] = [messages.Get(MessageKey.CockpitCloudflareR2Invalid)];
        if (problems.Count > 0) return Results.ValidationProblem(problems);

        var server = http.RequireInstanceServer();
        await policies.StageAsync(db, policy, cancellationToken);
        await StageAuditAsync(db, server.Id, http.User.RequireUserId(), messages.Get(MessageKey.AuditSettingsUpdated), cancellationToken);
        if (!await db.TrySaveChangesAsync(cancellationToken)) return Results.Conflict();
        policies.Publish(policy);
        return Results.Ok(new CloudflareR2Dto(
            policy.Enabled, policy.Endpoint, policy.Region, policy.Bucket, policy.Prefix, policies.Source));
    }

    private static async Task<IResult> ResetCloudflareR2Async(HttpContext http, AppDbContext db,
        CloudflareR2PolicyStore policies, Messages messages, CancellationToken cancellationToken)
    {
        var server = http.RequireInstanceServer();
        await policies.StageResetAsync(db, cancellationToken);
        await StageAuditAsync(db, server.Id, http.User.RequireUserId(), messages.Get(MessageKey.AuditSettingsUpdated), cancellationToken);
        if (!await db.TrySaveChangesAsync(cancellationToken)) return Results.Conflict();
        policies.Reset();
        var settings = policies.Current;
        return Results.Ok(new CloudflareR2Dto(
            settings.Enabled, settings.Endpoint, settings.Region, settings.Bucket, settings.Prefix, policies.Source));
    }
}
