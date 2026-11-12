using Stellarr.Api.Auth;
using Stellarr.Api.Contracts;
using Stellarr.Api.Data;
using Stellarr.Api.Localization;
using Stellarr.Api.Secrets;

namespace Stellarr.Api.Endpoints;

// Secrets the operator sets in Cockpit. They only go in: a read says whether
// each is set and where from, never what it is.
public static partial class CockpitEndpoints
{
    private static async Task<IResult> GetSecretsAsync(InstanceSecrets secrets, CancellationToken cancellationToken)
    {
        var resolved = await secrets.ReadAsync(cancellationToken);
        return Results.Ok(SecretNames.All.Select(definition => ToSecretDto(definition, resolved)).ToArray());
    }

    private static async Task<IResult> SetSecretAsync(
        string name,
        SetCockpitSecretRequest request,
        HttpContext http,
        AppDbContext db,
        InstanceSecrets secrets,
        Messages messages,
        CancellationToken cancellationToken)
    {
        var server = http.RequireInstanceServer();
        if (SecretNames.Find(name) is not { } definition)
        {
            return Results.NotFound();
        }

        var value = request.Value ?? "";
        if (!SecretNames.IsValidValue(value))
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["value"] = [messages.Get(MessageKey.CockpitSecretValueInvalid, ("max", SecretNames.MaxLength))],
            });
        }

        await secrets.SetAsync(definition, value, cancellationToken);
        await StageAuditAsync(
            db,
            server.Id,
            http.User.RequireUserId(),
            messages.Get(MessageKey.AuditSecretSet, ("name", definition.Name)),
            cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return Results.Ok(ToSecretDto(definition, await secrets.ReadAsync(cancellationToken)));
    }

    private static async Task<IResult> ClearSecretAsync(
        string name,
        HttpContext http,
        AppDbContext db,
        InstanceSecrets secrets,
        Messages messages,
        CancellationToken cancellationToken)
    {
        var server = http.RequireInstanceServer();
        if (SecretNames.Find(name) is not { } definition)
        {
            return Results.NotFound();
        }

        await secrets.ClearAsync(definition, cancellationToken);
        await StageAuditAsync(
            db,
            server.Id,
            http.User.RequireUserId(),
            messages.Get(MessageKey.AuditSecretCleared, ("name", definition.Name)),
            cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return Results.Ok(ToSecretDto(definition, await secrets.ReadAsync(cancellationToken)));
    }

    private static CockpitSecretDto ToSecretDto(SecretDefinition definition, ResolvedSecrets resolved)
    {
        var value = resolved[definition.Name];
        return new CockpitSecretDto(
            definition.Name,
            value.IsSet,
            value.Source switch
            {
                SecretSource.Panel => "panel",
                SecretSource.Environment => "environment",
                _ => "none",
            },
            definition.Variable,
            resolved.PanelUpdatedAt.TryGetValue(definition.Name, out var updatedAt) ? updatedAt : null);
    }
}
