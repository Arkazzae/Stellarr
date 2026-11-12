using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Data;
using Stellarr.Api.Secrets;

namespace Stellarr.Cli;

internal static class SecretsCommands
{
    internal static async Task<CliResult> ListAsync(CliRuntime runtime, CancellationToken cancellationToken)
    {
        await using var database = await runtime.OpenDatabaseAsync(mutation: false, cancellationToken);
        var db = database.Context;
        var secrets = new InstanceSecrets(
            db,
            runtime.ReadProtection(),
            runtime.Configuration,
            CliRuntime.NullLogger<InstanceSecrets>());
        var resolved = await secrets.ReadAsync(cancellationToken);
        var warnings = new List<string>();
        var panelRows = await db.InstanceSecrets.AsNoTracking().CountAsync(cancellationToken);
        if (panelRows > 0 && !SecretProtection.HasKeyFiles(runtime.KeysDirectory))
        {
            warnings.Add(
                $"The database has {panelRows} stored secret(s), but the data-protection keys are missing from {runtime.KeysDirectory}; those values count as unset until the API and the keys are restored.");
        }

        var items = SecretNames.All.Select(definition =>
        {
            var value = resolved[definition.Name];
            return new SecretItem(
                definition.Name,
                value.IsSet,
                SourceName(value.Source),
                definition.Variable,
                resolved.PanelUpdatedAt.TryGetValue(definition.Name, out var updatedAt) ? updatedAt : null);
        }).ToArray();

        var lines = items.Select(item =>
            $"{item.Name}: {(item.Configured ? "configured" : "not set")} [{item.Source}; fallback {item.Variable}]" +
            (item.UpdatedAt is { } updated ? $" updated {updated:O}" : "")).ToList();
        return new CliResult("secrets.list", new { secrets = items, warnings }, lines, Warnings: warnings);
    }

    internal static async Task<CliResult> SetAsync(
        CliRuntime runtime,
        string name,
        CancellationToken cancellationToken)
    {
        var definition = SecretNames.Find(name) ?? throw UnknownSecret(name);
        if (runtime.Invocation.Stdin && !runtime.Invocation.Yes)
        {
            throw new CliException(
                "confirmation_required",
                "--stdin supplies the secret itself, so it cannot also answer a confirmation. Add --yes.",
                CliExit.Usage);
        }

        // Fail before asking for anything when the key ring the API uses is
        // absent, so a stored value can never be unreadable by the running API.
        _ = runtime.WriteProtection();

        await using var database = await runtime.OpenDatabaseAsync(mutation: true, cancellationToken);
        var db = database.Context;
        runtime.Confirm($"Will store the secret '{definition.Name}' (value hidden).");
        var value = runtime.ReadSecret();
        if (!SecretNames.IsValidValue(value))
        {
            throw new CliException(
                "invalid_secret",
                $"The secret must be non-blank and at most {SecretNames.MaxLength} characters.",
                CliExit.Usage);
        }

        var secrets = new InstanceSecrets(
            db,
            runtime.WriteProtection(),
            runtime.Configuration,
            CliRuntime.NullLogger<InstanceSecrets>());
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        try
        {
            await secrets.SetAsync(definition, value, cancellationToken);
            db.OperatorAuditEntries.Add(CliDatabase.Audit("secrets.set", definition.Name));
            await db.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch
        {
            // Never hand a provider or database message about the value back to
            // the terminal. The original exception stays out of the output.
            throw new CliException(
                "secret_write_failed",
                $"The secret '{definition.Name}' could not be stored. Nothing was changed.",
                CliExit.Failure);
        }

        var resolved = await secrets.ReadAsync(cancellationToken);
        var item = new SecretItem(
            definition.Name,
            resolved[definition.Name].IsSet,
            SourceName(resolved[definition.Name].Source),
            definition.Variable,
            resolved.PanelUpdatedAt.TryGetValue(definition.Name, out var updatedAt) ? updatedAt : null);
        return new CliResult(
            "secrets.set",
            item,
            [
                $"Stored {definition.Name} encrypted in the instance database. The value was not printed.",
                "Cockpit and the API read the same value; the database override wins over the environment.",
                "Audit: local-cli secrets.set " + definition.Name,
            ]);
    }

    internal static async Task<CliResult> ClearAsync(
        CliRuntime runtime,
        string name,
        CancellationToken cancellationToken)
    {
        var definition = SecretNames.Find(name) ?? throw UnknownSecret(name);
        await using var database = await runtime.OpenDatabaseAsync(mutation: true, cancellationToken);
        var db = database.Context;
        var row = await db.InstanceSecrets.SingleOrDefaultAsync(x => x.Name == definition.Name, cancellationToken);
        var secrets = new InstanceSecrets(
            db,
            runtime.ReadProtection(),
            runtime.Configuration,
            CliRuntime.NullLogger<InstanceSecrets>());
        if (row is null)
        {
            var current = (await secrets.ReadAsync(cancellationToken))[definition.Name];
            var source = SourceName(current.Source);
            return new CliResult(
                "secrets.clear",
                new SecretItem(definition.Name, current.IsSet, source, definition.Variable, null),
                [
                    $"No database override exists for {definition.Name}; nothing changed.",
                    source == "environment"
                        ? $"The environment value ({definition.Variable}) still applies."
                        : $"No value is set in the database or in {definition.Variable}.",
                ]);
        }

        runtime.Confirm($"Will remove the database override for the secret '{definition.Name}'.");
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        await secrets.ClearAsync(definition, cancellationToken);
        db.OperatorAuditEntries.Add(CliDatabase.Audit("secrets.clear", definition.Name));
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        var resolved = await secrets.ReadAsync(cancellationToken);
        var value = resolved[definition.Name];
        var resultSource = SourceName(value.Source);
        return new CliResult(
            "secrets.clear",
            new SecretItem(
                definition.Name,
                value.IsSet,
                resultSource,
                definition.Variable,
                null),
            [
                $"Removed the database override for {definition.Name}.",
                value.Source == SecretSource.Environment
                    ? $"The environment value ({definition.Variable}) applies again."
                    : $"No value is configured in the environment ({definition.Variable}); integrations that need it stay unavailable.",
                "Audit: local-cli secrets.clear " + definition.Name,
            ]);
    }

    private static string SourceName(SecretSource source) => source switch
    {
        // The API calls a stored override "panel"; this CLI says "database"
        // so its output does not imply the value came from Cockpit.
        SecretSource.Panel => "database",
        SecretSource.Environment => "environment",
        _ => "none",
    };

    private static CliException UnknownSecret(string name) => new(
        "secret_not_found",
        $"No secret named '{name}'. Available names: {string.Join(", ", SecretNames.All.Select(x => x.Name))}.",
        CliExit.NotFound);
}

internal sealed record SecretItem(
    string Name,
    bool Configured,
    string Source,
    string Variable,
    DateTime? UpdatedAt);
