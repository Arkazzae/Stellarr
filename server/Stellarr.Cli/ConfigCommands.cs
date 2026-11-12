using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;
using Stellarr.Api.Mail;
using Stellarr.Api.Operations;
using Stellarr.Api.Secrets;

namespace Stellarr.Cli;

internal static class ConfigCommands
{
    internal static async Task<CliResult> ListAsync(CliRuntime runtime, CancellationToken cancellationToken)
    {
        await using var database = await runtime.OpenDatabaseAsync(mutation: false, cancellationToken);
        var state = await LoadAsync(runtime, database.Context, cancellationToken);
        var settings = new List<object>();
        var lines = new List<string>();

        foreach (var definition in SettingsCatalog.Writable)
        {
            var value = definition.ReadConfigured(state.Settings, state.Server, state.Secrets);
            var effective = definition.ReadEffective(state.Settings, state.Server, state.Secrets);
            var source = SourceOf(definition, state.Persisted, state.Settings, runtime.Configuration);
            settings.Add(Describe(
                definition.Key, value, effective, source,
                editable: true, restartRequired: false, null, null));
            lines.Add($"{definition.Key} = {SettingsCatalog.Display(value)}  [{source}; editable{Suffix(value, effective)}]");
        }

        var startupContext = new StartupContext(runtime.Configuration, runtime.Environment);
        foreach (var definition in SettingsCatalog.Startup)
        {
            var value = definition.Read(startupContext);
            settings.Add(Describe(
                definition.Key, value.Value, value.Value, value.Source,
                editable: false, restartRequired: true,
                definition.EnvironmentVariable, definition.Guidance));
            lines.Add($"{definition.Key} = {SettingsCatalog.Display(value.Value)}  [{value.Source}; read-only, restart required]");
        }

        return new CliResult("config.list", new { settings }, lines);
    }

    internal static async Task<CliResult> GetAsync(
        CliRuntime runtime,
        string key,
        CancellationToken cancellationToken)
    {
        await using var database = await runtime.OpenDatabaseAsync(mutation: false, cancellationToken);
        var state = await LoadAsync(runtime, database.Context, cancellationToken);
        if (SettingsCatalog.FindWritable(key) is { } writable)
        {
            var value = writable.ReadConfigured(state.Settings, state.Server, state.Secrets);
            var effective = writable.ReadEffective(state.Settings, state.Server, state.Secrets);
            var source = SourceOf(writable, state.Persisted, state.Settings, runtime.Configuration);
            var item = Describe(
                writable.Key, value, effective, source,
                editable: true, restartRequired: false, null, null);
            return new CliResult(
                "config.get",
                item,
                [$"{writable.Key} = {SettingsCatalog.Display(value)}  [{source}; editable{Suffix(value, effective)}]"]);
        }

        if (SettingsCatalog.FindStartup(key) is { } startup)
        {
            var value = startup.Read(new StartupContext(runtime.Configuration, runtime.Environment));
            var item = Describe(
                startup.Key, value.Value, value.Value, value.Source,
                editable: false, restartRequired: true,
                startup.EnvironmentVariable, startup.Guidance);
            return new CliResult(
                "config.get",
                item,
                [
                    $"{startup.Key} = {SettingsCatalog.Display(value.Value)}  [{value.Source}; read-only, restart required]",
                    startup.Guidance,
                ]);
        }

        throw UnknownSetting(key);
    }

    internal static async Task<CliResult> SetAsync(
        CliRuntime runtime,
        string key,
        string rawValue,
        CancellationToken cancellationToken)
    {
        if (SecretNames.Find(key) is { } secret)
        {
            throw new CliException(
                "secret_not_configuration",
                $"'{key}' is a secret, not a configuration setting. Use 'stellarr secrets set {secret.Name}'.",
                CliExit.Usage);
        }

        if (SettingsCatalog.FindStartup(key) is { } startup)
        {
            throw new CliException(
                "read_only_setting",
                $"'{key}' is a startup setting and cannot be stored from the CLI. {startup.Guidance}",
                CliExit.Conflict,
                new { key, environmentVariable = startup.EnvironmentVariable, guidance = startup.Guidance });
        }

        var definition = SettingsCatalog.FindWritable(key) ?? throw UnknownSetting(key);
        var value = Normalize(definition, rawValue);

        await using var database = await runtime.OpenDatabaseAsync(mutation: true, cancellationToken);
        var db = database.Context;
        var server = await CommandSupport.RequireInstanceServerAsync(db, cancellationToken, tracked: true);
        var settings = await InstanceSettingsService.LoadAsync(
            db, server, runtime.Configuration, cancellationToken);
        var secrets = stateSecrets(runtime, db);
        var resolved = await secrets.ReadAsync(cancellationToken);
        var previous = definition.ReadConfigured(settings, server, resolved);
        var request = definition.Apply(
            InstanceSettingsService.Snapshot(server, settings),
            value);
        var problems = InstanceSettingsService.Validate(request, runtime.Messages);
        if (problems.Count > 0)
        {
            throw InvalidSettings(problems);
        }

        var preview = $"Will set '{definition.Key}' from '{SettingsCatalog.Display(previous)}' to '{value}'.";
        runtime.Confirm(preview);

        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        InstanceSettingsService.Apply(settings, server, request);
        db.OperatorAuditEntries.Add(CliDatabase.Audit("config.set", definition.Key));
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        var newValue = definition.ReadConfigured(settings, server, resolved);
        var newEffective = definition.ReadEffective(settings, server, resolved);
        var data = Describe(
            definition.Key,
            newValue,
            newEffective,
            "database",
            editable: true,
            restartRequired: false,
            null,
            null) with
        {
            PreviousValue = previous,
            AuditActor = "local-cli",
        };
        var warnings = new List<string>();
        if (!Equals(newValue, newEffective))
        {
            warnings.Add(
                $"{definition.Key} is stored as {SettingsCatalog.Display(newValue)}, but its effective availability is {SettingsCatalog.Display(newEffective)} until its secret is set.");
        }

        return new CliResult(
            "config.set",
            data,
            [
                $"Set {definition.Key}: {SettingsCatalog.Display(previous)} -> {SettingsCatalog.Display(newValue)}" +
                (Equals(newValue, newEffective) ? "" : $" (effective {SettingsCatalog.Display(newEffective)})"),
                "Stored in the instance database; Cockpit reads the same row. No restart is needed.",
                "Audit: local-cli config.set " + definition.Key,
            ],
            Warnings: warnings);
    }

    internal static async Task<CliResult> ValidateAsync(
        CliRuntime runtime,
        CancellationToken cancellationToken)
    {
        await using var database = await runtime.OpenDatabaseAsync(mutation: false, cancellationToken);
        var db = database.Context;
        var server = await CommandSupport.RequireInstanceServerAsync(db, cancellationToken);
        var settings = await InstanceSettingsService.LoadAsync(
            db, server, runtime.Configuration, cancellationToken);
        var request = InstanceSettingsService.Snapshot(server, settings);
        var problems = InstanceSettingsService.Validate(request, runtime.Messages);
        var secrets = stateSecrets(runtime, db);
        var resolved = await secrets.ReadAsync(cancellationToken);
        var warnings = new List<string>();
        var transport = MailTransports.Resolve(settings, resolved);
        if (settings.MailingEnabled && !transport.Ready)
        {
            warnings.Add(transport.Provider == MailProvider.Resend
                ? "Mail is enabled but the Resend key is not set."
                : "Mail is enabled but the SMTP host is not set.");
        }

        if (settings.MailResendEnabled == true && !resolved.ResendApiKey.IsSet)
        {
            warnings.Add("Resend is selected but its API key is not set.");
        }

        if (settings.GiphyEnabled == true && !resolved.GiphyApiKey.IsSet)
        {
            warnings.Add("GIFs are enabled but the GIPHY API key is not set.");
        }

        var valid = problems.Count == 0;
        var lines = new List<string>();
        lines.AddRange(problems.Select(problem => $"{problem.Key}: {string.Join(" ", problem.Value)}"));
        lines.AddRange(warnings.Select(warning => $"warning: {warning}"));
        lines.Add(valid ? "Configuration is valid. Nothing was saved or sent." : "Configuration is invalid. Nothing was saved.");
        return new CliResult(
            "config.validate",
            new
            {
                valid,
                problems,
                warnings,
                mailProvider = MailTransports.NameOf(transport.Provider),
                mailReady = transport.Ready,
                giphyEnabled = settings.GiphyEnabled,
            },
            lines,
            valid ? CliExit.Success : CliExit.Usage);
    }

    private static async Task<ConfigState> LoadAsync(
        CliRuntime runtime,
        AppDbContext db,
        CancellationToken cancellationToken)
    {
        var server = await CommandSupport.RequireInstanceServerAsync(db, cancellationToken);
        var persisted = await db.OperationsSettings.AsNoTracking()
            .AnyAsync(x => x.ServerId == server.Id, cancellationToken);
        var settings = await InstanceSettingsService.LoadAsync(
            db, server, runtime.Configuration, cancellationToken);
        var secrets = stateSecrets(runtime, db);
        return new ConfigState(server, settings, persisted, await secrets.ReadAsync(cancellationToken));
    }

    private static InstanceSecrets stateSecrets(CliRuntime runtime, AppDbContext db) => new(
        db,
        runtime.ReadProtection(),
        runtime.Configuration,
        CliRuntime.NullLogger<InstanceSecrets>());

    private static string SourceOf(
        WriteSetting definition,
        bool persisted,
        OperationsSettings settings,
        IConfiguration configuration)
    {
        if (definition.Key == "instance.name")
        {
            return "database";
        }

        if (persisted && definition.IsStored(settings))
        {
            return "database";
        }

        return definition.SeedConfigurationKey is { } seed && configuration[seed] is not null
            ? "configuration"
            : "default";
    }

    private static ConfigItem Describe(
        string key,
        object? value,
        object? effective,
        string source,
        bool editable,
        bool restartRequired,
        string? environmentVariable,
        string? guidance) => new(
            key,
            value,
            effective,
            source,
            editable,
            restartRequired,
            environmentVariable,
            guidance,
            null,
            null);

    private static string Suffix(object? value, object? effective) =>
        Equals(value, effective) ? "" : $"; effective {SettingsCatalog.Display(effective)}";

    private static string Normalize(WriteSetting definition, string rawValue)
    {
        var value = rawValue.Trim();
        if (value.Length == 0 && definition.Kind is not (SettingKind.Text or SettingKind.MailAddress))
        {
            throw new CliException("invalid_value", $"'{definition.Key}' needs a value.", CliExit.Usage);
        }

        return definition.Kind switch
        {
            SettingKind.Boolean => SettingsCatalog.ParseBoolean(value) ? "true" : "false",
            SettingKind.Integer => SettingsCatalog.ParseInteger(value).ToString(CultureInfo.InvariantCulture),
            SettingKind.MfaRequirement => NormalizeMfaRequirement(value),
            SettingKind.TimeZone or SettingKind.MailAddress or SettingKind.SmtpSecurity or SettingKind.Text => value,
            _ => value,
        };
    }

    private static string NormalizeMfaRequirement(string value)
    {
        var normalized = value.Trim().ToLowerInvariant();
        if (!MfaRequirements.IsKnown(normalized))
        {
            throw new CliException(
                "invalid_value",
                $"'{value}' is not an MFA requirement. Use optional, admins, everyone or cockpit.",
                CliExit.Usage);
        }

        return normalized;
    }

    private static CliException InvalidSettings(Dictionary<string, string[]> problems) => new(
        "invalid_value",
        string.Join(" ", problems.Select(problem => string.Join(" ", problem.Value))),
        CliExit.Usage,
        new { fields = problems });

    private static CliException UnknownSetting(string key) => new(
        "setting_not_found",
        $"No setting named '{key}'. Run 'stellarr config list' to see the available keys.",
        CliExit.NotFound);
}

internal sealed record ConfigState(
    StellarrServer Server,
    OperationsSettings Settings,
    bool Persisted,
    ResolvedSecrets Secrets);

internal sealed record ConfigItem(
    string Key,
    object? Value,
    object? EffectiveValue,
    string Source,
    bool Editable,
    bool RestartRequired,
    string? EnvironmentVariable,
    string? Guidance,
    object? PreviousValue,
    string? AuditActor);
