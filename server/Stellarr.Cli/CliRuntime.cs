using System.Collections;
using System.Xml.Linq;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.DataProtection.KeyManagement;
using Microsoft.AspNetCore.DataProtection.Repositories;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;
using Stellarr.Api.Localization;

namespace Stellarr.Cli;

/// <summary>
/// Everything a command needs outside its database: the resolved data root,
/// the configuration used for seed defaults, the terminal streams and the
/// confirmation rules.
/// </summary>
internal sealed class CliRuntime
{
    private const string DefaultContainerDataRoot = "/data/stellarr";

    private CliRuntime(
        CliInvocation invocation,
        string dataRoot,
        IConfiguration configuration,
        IReadOnlyDictionary<string, string?> environment,
        TextReader input,
        TextWriter output,
        TextWriter error,
        bool interactive,
        Func<string?>? secretPrompt)
    {
        Invocation = invocation;
        DataRoot = dataRoot;
        Configuration = configuration;
        Environment = environment;
        Input = input;
        Output = output;
        Error = error;
        Interactive = interactive;
        SecretPrompt = secretPrompt;
        Messages = new Messages(new LanguageOptions { Language = LanguageOptions.English });
    }

    internal CliInvocation Invocation { get; }

    internal string DataRoot { get; }

    internal IConfiguration Configuration { get; }

    /// <summary>The raw environment of this exec, before entrypoint exports.</summary>
    internal IReadOnlyDictionary<string, string?> Environment { get; }

    internal TextReader Input { get; }

    internal TextWriter Output { get; }

    internal TextWriter Error { get; }

    internal bool Interactive { get; }

    internal Func<string?>? SecretPrompt { get; }

    internal Messages Messages { get; }

    internal bool Json => Invocation.Json;

    internal string DatabasePath => Path.Combine(DataRoot, "db", "stellarr.db");

    internal string KeysDirectory => Path.Combine(DataRoot, "keys");

    internal bool DatabaseExists => File.Exists(DatabasePath);

    internal static CliRuntime Create(
        CliInvocation invocation,
        TextReader input,
        TextWriter output,
        TextWriter error,
        bool interactive,
        Func<string?>? secretPrompt,
        IReadOnlyDictionary<string, string?>? environment = null)
    {
        var environmentValues = environment ?? CurrentEnvironment();
        var configurationBuilder = new ConfigurationBuilder()
            .SetBasePath(AppContext.BaseDirectory)
            .AddJsonFile("appsettings.json", optional: true, reloadOnChange: false);
        if (environment is null)
        {
            configurationBuilder.AddEnvironmentVariables();
        }
        else
        {
            // A test or an embedding process can supply the exec environment
            // without changing the process-wide one. Keep the double-underscore
            // form too, as the environment configuration provider does.
            var values = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase);
            foreach (var (name, value) in environment)
            {
                values[name] = value;
                values[name.Replace("__", ":", StringComparison.Ordinal)] = value;
            }

            configurationBuilder.AddInMemoryCollection(values);
        }

        var configuration = configurationBuilder.Build();
        return new CliRuntime(
            invocation,
            ResolveDataRoot(invocation.DataRoot, configuration, environmentValues),
            configuration,
            environmentValues,
            input,
            output,
            error,
            interactive,
            secretPrompt);
    }

    internal async Task<CliDatabase> OpenDatabaseAsync(
        bool mutation,
        CancellationToken cancellationToken)
    {
        if (!DatabaseExists)
        {
            throw new CliException(
                "database_not_found",
                $"No Stellarr database exists at {DatabasePath}. Check --data-root or STELLARR_DATA_ROOT; the CLI never creates one.",
                CliExit.NotFound,
                new { dataRoot = DataRoot, database = DatabasePath });
        }

        return await CliDatabase.OpenAsync(this, mutation, cancellationToken);
    }

    /// <summary>
    /// The key ring as it exists. A read command never creates the directory or
    /// a key: without a key ring, panel secrets simply cannot be decrypted and
    /// the environment's values are the ones that count.
    /// </summary>
    internal IDataProtectionProvider ReadProtection() =>
        SecretProtection.HasKeyFiles(KeysDirectory)
            ? SecretProtection.Persisted(KeysDirectory, allowGeneration: false)
            : new EphemeralDataProtectionProvider();

    internal IDataProtectionProvider WriteProtection()
    {
        if (!Directory.Exists(KeysDirectory))
        {
            throw new CliException(
                "data_protection_keys_missing",
                $"The data-protection key directory {KeysDirectory} does not exist, so a secret written now could not be read by the running API. Start the API once to create it, then retry.",
                CliExit.Conflict,
                new { keysDirectory = KeysDirectory });
        }

        return SecretProtection.Persisted(KeysDirectory, allowGeneration: true);
    }

    internal static ILogger<T> NullLogger<T>() => Microsoft.Extensions.Logging.Abstractions.NullLogger<T>.Instance;

    /// <summary>
    /// Shows what is about to change and asks for confirmation. Automation must
    /// pass --yes; a closed stdin fails immediately instead of waiting.
    /// </summary>
    internal void Confirm(string preview)
    {
        if (Invocation.Yes)
        {
            return;
        }

        if (!Interactive)
        {
            throw new CliException(
                "confirmation_required",
                "This change needs confirmation. Re-run with --yes in a non-interactive session.",
                CliExit.Usage,
                new { preview });
        }

        if (Json)
        {
            Error.WriteLine(preview);
        }
        else
        {
            Output.WriteLine(preview);
        }

        Error.Write("Continue? [y/N] ");
        var answer = Input.ReadLine()?.Trim();
        if (!string.Equals(answer, "y", StringComparison.OrdinalIgnoreCase) &&
            !string.Equals(answer, "yes", StringComparison.OrdinalIgnoreCase))
        {
            throw new CliException("cancelled", "Cancelled; nothing was changed.", CliExit.Usage);
        }
    }

    /// <summary>
    /// A secret comes only from --stdin or a hidden prompt. It is never read
    /// from a positional argument, where a shell has already copied it into the
    /// process list and history.
    /// </summary>
    internal string ReadSecret()
    {
        if (Invocation.Stdin)
        {
            if (!Invocation.Yes)
            {
                throw new CliException(
                    "confirmation_required",
                    "--stdin supplies the secret itself, so it cannot also answer a confirmation. Add --yes.",
                    CliExit.Usage);
            }

            var piped = Input.ReadToEnd();
            return StripOneLineEnding(piped);
        }

        if (!Interactive || SecretPrompt is null)
        {
            throw new CliException(
                "secret_value_required",
                "Provide the secret with --stdin, or run interactively for a hidden prompt. Secret values are not accepted as arguments.",
                CliExit.Usage);
        }

        return SecretPrompt() ?? "";
    }

    internal static string StripOneLineEnding(string value)
    {
        if (value.EndsWith("\r\n", StringComparison.Ordinal))
        {
            return value[..^2];
        }

        return value.EndsWith('\n') || value.EndsWith('\r') ? value[..^1] : value;
    }

    private static string ResolveDataRoot(
        string? explicitRoot,
        IConfiguration configuration,
        IReadOnlyDictionary<string, string?> environment)
    {
        var selected = explicitRoot;
        if (string.IsNullOrWhiteSpace(selected))
        {
            selected = ContainerSettings.EnvironmentValue(environment, "STELLARR_DATA_ROOT");
        }

        if (string.IsNullOrWhiteSpace(selected))
        {
            selected = configuration["DataRoot"];
        }

        selected = string.IsNullOrWhiteSpace(selected) ? DefaultContainerDataRoot : selected.Trim();
        return Path.GetFullPath(selected);
    }

    private static Dictionary<string, string?> CurrentEnvironment()
    {
        var values = new Dictionary<string, string?>(StringComparer.Ordinal);
        foreach (DictionaryEntry entry in System.Environment.GetEnvironmentVariables())
        {
            values[Convert.ToString(entry.Key, System.Globalization.CultureInfo.InvariantCulture) ?? ""] =
                Convert.ToString(entry.Value, System.Globalization.CultureInfo.InvariantCulture);
        }

        return values;
    }
}

/// <summary>Read-only or read-write access to the one existing SQLite database.</summary>
internal sealed class CliDatabase(AppDbContext context) : IAsyncDisposable
{
    private static readonly string[] AuditColumns = ["Id", "Actor", "Operation", "Target", "CreatedAt"];

    internal AppDbContext Context { get; } = context;

    internal static async Task<CliDatabase> OpenAsync(
        CliRuntime runtime,
        bool mutation,
        CancellationToken cancellationToken)
    {
        var connection = new SqliteConnectionStringBuilder
        {
            DataSource = runtime.DatabasePath,
            // ReadOnly for inspection, ReadWrite for a mutation. Never
            // ReadWriteCreate: a missing file is an error, not a new empty
            // installation.
            Mode = mutation ? SqliteOpenMode.ReadWrite : SqliteOpenMode.ReadOnly,
            Cache = SqliteCacheMode.Shared,
            Pooling = false,
            DefaultTimeout = 5,
        }.ToString();
        var context = new AppDbContext(
            new DbContextOptionsBuilder<AppDbContext>().UseSqlite(connection).Options);
        try
        {
            await context.Database.OpenConnectionAsync(cancellationToken);
            // Connection-local pragmas only. The CLI never changes journal mode
            // or runs a schema step.
            await context.Database.ExecuteSqlRawAsync("PRAGMA busy_timeout=5000;", cancellationToken);
            await context.Database.ExecuteSqlRawAsync("PRAGMA foreign_keys=ON;", cancellationToken);
            await VerifySchemaAsync(context, mutation, cancellationToken);
            return new CliDatabase(context);
        }
        catch
        {
            await context.DisposeAsync();
            throw;
        }
    }

    internal static OperatorAuditEntry Audit(string operation, string target) => new()
    {
        Id = Guid.NewGuid(),
        Actor = "local-cli",
        Operation = operation,
        Target = target,
        CreatedAt = DateTime.UtcNow,
    };

    public async ValueTask DisposeAsync() => await Context.DisposeAsync();

    private static async Task VerifySchemaAsync(
        AppDbContext context,
        bool mutation,
        CancellationToken cancellationToken)
    {
        var tables = await ReadTablesAsync(context, cancellationToken);
        var required = new (string Table, string[] Columns)[]
        {
            ("Users", ["Id", "Username", "NormalizedUsername", "DisplayName", "PasswordHash", "IsDisabled", "SessionVersion", "SecurityRecoveryRequired", "AvatarColor", "CreatedAt"]),
            ("Servers", ["Id", "Name", "CreatedAt"]),
            ("ServerRoles", ["Id", "ServerId", "Name", "IsOwner"]),
            ("ServerMembers", ["ServerId", "UserId", "RoleId", "JoinedAt"]),
            ("UserSessions", ["Id", "UserId", "Device", "IpAddress", "CreatedAt", "LastSeenAt", "ExpiresAt", "RevokedAt", "AbsoluteExpiresAt", "PrimarySource", "MfaCompletedAt", "MfaEvidence", "SecurityVersion"]),
            ("DesktopBrowserLogins", ["Id", "UserId", "CreatedAt", "ExpiresAt", "ApprovedAt", "RedeemedAt", "ApprovalTokenHash", "ApprovalUserId", "ApprovalSessionId", "ApprovedSessionId", "SecurityVersion"]),
            ("MfaMethods", ["Id", "UserId", "Type", "Name", "CreatedAt", "ConfirmedAt", "RevokedAt"]),
            ("RecoveryCodes", ["Id", "UserId", "BatchId", "CodeHash", "CreatedAt", "UsedAt"]),
            ("TrustedDevices", ["Id", "UserId", "TokenHash", "Name", "CreatedAt", "ExpiresAt", "RevokedAt"]),
            ("CliRecoveryCredentials", ["Id", "UserId", "TokenHash", "Reason", "SecurityVersion", "CreatedAt", "ExpiresAt", "UsedAt"]),
            ("SecurityEvents", ["Id", "UserId", "Kind", "Detail", "CreatedAt"]),
            ("OperationsSettings", ["ServerId", "TimeZone", "MailingEnabled", "MailFromAddress", "MailSmtpHost", "MailSmtpPort", "MailSmtpUsername", "MailSmtpSecurity", "MailResendEnabled", "GiphyEnabled", "InviteMailEnabled", "RecoveryMailEnabled", "AlertMailEnabled", "BackupRetentionDays", "LogRetentionDays", "OrphanObjectRetentionDays", "AutomaticCleanupEnabled", "MfaRequirement", "TrustedDeviceDays", "AuthChallengeMinutes", "EmailCodeMinutes", "EmailCodeCooldownSeconds", "EmailCodeMaxAttempts", "EmailCodeSendsPerHour", "CliRecoveryMinutes", "UpdatedAt"]),
            ("InstanceSecrets", ["Name", "ProtectedValue", "UpdatedAt"]),
        };
        var missingTables = required.Select(x => x.Table).Where(table => !tables.Contains(table)).ToList();
        foreach (var (table, columns) in required)
        {
            if (missingTables.Contains(table))
            {
                continue;
            }

            var existing = await ReadColumnsAsync(context, table, cancellationToken);
            missingTables.AddRange(columns.Where(column => !existing.Contains(column))
                .Select(column => $"{table}.{column}"));
        }

        if (mutation && !tables.Contains("OperatorAuditEntries"))
        {
            missingTables.Add("OperatorAuditEntries");
        }
        else if (mutation)
        {
            var auditColumns = await ReadColumnsAsync(context, "OperatorAuditEntries", cancellationToken);
            missingTables.AddRange(
                AuditColumns
                    .Where(column => !auditColumns.Contains(column))
                    .Select(column => $"OperatorAuditEntries.{column}"));
        }

        if (missingTables.Count > 0)
        {
            throw new CliException(
                "schema_incompatible",
                "This database is missing tables or columns this release needs. Start the API once so it can upgrade the schema, then retry. The CLI never migrates or initializes a database.",
                CliExit.Conflict,
                new { database = context.Database.GetDbConnection().DataSource, missing = missingTables });
        }
    }

    private static async Task<HashSet<string>> ReadTablesAsync(
        AppDbContext context,
        CancellationToken cancellationToken)
    {
        var tables = new HashSet<string>(StringComparer.Ordinal);
        await using var command = context.Database.GetDbConnection().CreateCommand();
        command.CommandText = "SELECT name FROM sqlite_master WHERE type = 'table'";
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            tables.Add(reader.GetString(0));
        }

        return tables;
    }

    private static async Task<HashSet<string>> ReadColumnsAsync(
        AppDbContext context,
        string table,
        CancellationToken cancellationToken)
    {
        var columns = new HashSet<string>(StringComparer.Ordinal);
        await using var command = context.Database.GetDbConnection().CreateCommand();
        command.CommandText = $"PRAGMA table_info(\"{table}\")";
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            columns.Add(reader.GetString(1));
        }

        return columns;
    }
}

internal static class SecretProtection
{
    internal static bool HasKeyFiles(string directory) =>
        Directory.Exists(directory) &&
        Directory.EnumerateFiles(directory, "*.xml", SearchOption.TopDirectoryOnly).Any();

    internal static IDataProtectionProvider Persisted(string directory, bool allowGeneration)
    {
        var keyDirectory = new DirectoryInfo(directory);
        if (allowGeneration)
        {
            return DataProtectionProvider.Create(
                keyDirectory, builder => builder.SetApplicationName("Stellarr"));
        }

        // Read commands need automatic generation to make an all-expired ring
        // usable at all, but generation must stay in memory. Loading the XML
        // documents into the supported IXmlRepository extension point gives the
        // key manager the same keys, revocations and material without ever
        // writing a new file to the data directory.
        var repository = MemoryXmlRepository.Load(directory);
        return DataProtectionProvider.Create(keyDirectory, builder =>
        {
            builder.SetApplicationName("Stellarr");
            builder.Services.Configure<KeyManagementOptions>(options => options.XmlRepository = repository);
        });
    }
}

/// <summary>
/// A read-only snapshot of the XML key and revocation documents. Additions stay
/// in memory, so a generated default key for an expired ring never reaches the
/// data directory.
/// </summary>
internal sealed class MemoryXmlRepository : IXmlRepository
{
    private readonly object _gate = new();
    private readonly List<XElement> _elements;

    private MemoryXmlRepository(List<XElement> elements) => _elements = elements;

    internal static MemoryXmlRepository Load(string directory)
    {
        var elements = Directory.EnumerateFiles(directory, "*.xml", SearchOption.TopDirectoryOnly)
            .Order(StringComparer.Ordinal)
            .Select(path => XDocument.Load(path, LoadOptions.PreserveWhitespace).Root)
            .Where(root => root is not null)
            .Select(root => new XElement(root!))
            .ToList();
        return new MemoryXmlRepository(elements);
    }

    public IReadOnlyCollection<XElement> GetAllElements()
    {
        lock (_gate)
        {
            return _elements.Select(element => new XElement(element)).ToArray();
        }
    }

    public void StoreElement(XElement element, string friendlyName)
    {
        ArgumentNullException.ThrowIfNull(element);
        lock (_gate)
        {
            _elements.Add(new XElement(element));
        }
    }
}
