using System.Text.Json;
using Microsoft.Data.Sqlite;

namespace Stellarr.Cli;

public static class CliApplication
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true,
    };

    public static async Task<int> RunAsync(
        string[] args,
        TextReader input,
        TextWriter output,
        TextWriter error,
        bool interactive,
        Func<string?>? secretPrompt,
        CancellationToken cancellationToken,
        IReadOnlyDictionary<string, string?>? environment = null)
    {
        var jsonRequested = CliInvocation.JsonRequested(args);
        var commandName = string.Empty;
        try
        {
            var invocation = CliInvocation.Parse(args);
            commandName = invocation.Positionals.Count == 0 ? "" : invocation.Positionals[0].ToLowerInvariant();
            // A terminal switch never lets a write command through, even when
            // it was appended after the command's own arguments.
            if (invocation.Version)
            {
                return WriteVersion(jsonRequested, output);
            }

            if (invocation.Help || invocation.Positionals.Count == 0)
            {
                var helpCommand = invocation.Positionals.Count > 1
                    ? invocation.Positionals[1].ToLowerInvariant()
                    : commandName;
                return WriteHelp(jsonRequested, helpCommand, output);
            }

            if (commandName == "help")
            {
                return WriteHelp(
                    jsonRequested,
                    invocation.Positionals.Count > 1 ? invocation.Positionals[1].ToLowerInvariant() : "",
                    output);
            }

            if (commandName == "version")
            {
                EnsureCount(invocation, 1, "Usage: stellarr version");
                return WriteVersion(jsonRequested, output);
            }

            var runtime = CliRuntime.Create(
                invocation, input, output, error, interactive, secretPrompt, environment);
            var result = await DispatchAsync(runtime, invocation, cancellationToken);
            WriteResult(result, runtime.Json, output, error);
            return result.ExitCode;
        }
        catch (CliException exception)
        {
            WriteError(exception.Code, exception.Message, exception.ExitCode, exception.Details,
                commandName, jsonRequested, output, error);
            return exception.ExitCode;
        }
        catch (OperationCanceledException)
        {
            WriteError("cancelled", "Cancelled; nothing was changed.", CliExit.Usage, null,
                commandName, jsonRequested, output, error);
            return CliExit.Usage;
        }
        catch (SqliteException exception)
        {
            var mapped = MapDatabaseError(exception);
            WriteError(mapped.Code, mapped.Message, mapped.ExitCode, null,
                commandName, jsonRequested, output, error);
            return mapped.ExitCode;
        }
        catch (UnauthorizedAccessException)
        {
            WriteError("permission_denied", "The data volume or database is not readable by this process.",
                CliExit.Conflict, null, commandName, jsonRequested, output, error);
            return CliExit.Conflict;
        }
        catch (Exception exception)
        {
            WriteError(
                "unexpected_error",
                $"The command failed unexpectedly ({exception.GetType().Name}). Nothing is reported as changed.",
                CliExit.Failure,
                null,
                commandName,
                jsonRequested,
                output,
                error);
            return CliExit.Failure;
        }
    }

    private static async Task<CliResult> DispatchAsync(
        CliRuntime runtime,
        CliInvocation invocation,
        CancellationToken cancellationToken)
    {
        var positions = invocation.Positionals;
        var command = positions[0].ToLowerInvariant();
        switch (command)
        {
            case "status":
                EnsureReadOnly(invocation, "status", maximum: 1);
                return await StatusCommands.StatusAsync(runtime, cancellationToken);

            case "doctor":
                EnsureReadOnly(invocation, "doctor", maximum: 1);
                return await StatusCommands.DoctorAsync(runtime, cancellationToken);

            case "config":
                return await DispatchConfigAsync(runtime, invocation, cancellationToken);

            case "secrets":
                return await DispatchSecretsAsync(runtime, invocation, cancellationToken);

            case "users":
                return await DispatchUsersAsync(runtime, invocation, cancellationToken);

            case "sessions":
                return await DispatchSessionsAsync(runtime, invocation, cancellationToken);

            case "security":
                return await DispatchSecurityAsync(runtime, invocation, cancellationToken);

            default:
                throw new CliException(
                    "unknown_command",
                    $"Unknown command '{command}'. Run 'stellarr help' for the command list.",
                    CliExit.Usage);
        }
    }

    private static async Task<CliResult> DispatchConfigAsync(
        CliRuntime runtime,
        CliInvocation invocation,
        CancellationToken cancellationToken)
    {
        var positions = invocation.Positionals;
        if (positions.Count < 2)
        {
            throw Usage("config needs a subcommand: list, get, set or validate.");
        }

        var action = positions[1].ToLowerInvariant();
        switch (action)
        {
            case "list":
                EnsureReadOnly(invocation, "config list", maximum: 2);
                return await ConfigCommands.ListAsync(runtime, cancellationToken);

            case "get":
                EnsureReadOnly(invocation, "config get <key>", exact: 3);
                return await ConfigCommands.GetAsync(runtime, positions[2], cancellationToken);

            case "set":
                EnsureMutation(invocation, "config set <key> <value>", exact: 4, allowStdin: false, allowAll: false);
                return await ConfigCommands.SetAsync(runtime, positions[2], positions[3], cancellationToken);

            case "validate":
                EnsureReadOnly(invocation, "config validate", exact: 2);
                return await ConfigCommands.ValidateAsync(runtime, cancellationToken);

            default:
                throw Usage($"Unknown config subcommand '{action}'. Use list, get, set or validate.");
        }
    }

    private static async Task<CliResult> DispatchSecretsAsync(
        CliRuntime runtime,
        CliInvocation invocation,
        CancellationToken cancellationToken)
    {
        var positions = invocation.Positionals;
        if (positions.Count < 2)
        {
            throw Usage("secrets needs a subcommand: list, set or clear.");
        }

        var action = positions[1].ToLowerInvariant();
        switch (action)
        {
            case "list":
                EnsureReadOnly(invocation, "secrets list", maximum: 2);
                return await SecretsCommands.ListAsync(runtime, cancellationToken);

            case "set":
                if (positions.Count > 3)
                {
                    throw new CliException(
                        "secret_value_argument",
                        "A secret value is not accepted as an argument. Use --stdin or the hidden prompt.",
                        CliExit.Usage);
                }

                EnsureMutation(invocation, "secrets set <name> --stdin", exact: 3, allowStdin: true, allowAll: false);
                return await SecretsCommands.SetAsync(runtime, positions[2], cancellationToken);

            case "clear":
                EnsureMutation(invocation, "secrets clear <name>", exact: 3, allowStdin: false, allowAll: false);
                return await SecretsCommands.ClearAsync(runtime, positions[2], cancellationToken);

            default:
                throw Usage($"Unknown secrets subcommand '{action}'. Use list, set or clear.");
        }
    }

    private static async Task<CliResult> DispatchUsersAsync(
        CliRuntime runtime,
        CliInvocation invocation,
        CancellationToken cancellationToken)
    {
        var positions = invocation.Positionals;
        if (positions.Count < 2)
        {
            throw Usage("users needs a subcommand: list or show.");
        }

        return positions[1].ToLowerInvariant() switch
        {
            "list" => await ListUsersAsync(runtime, invocation, cancellationToken),
            "show" => await ShowUserAsync(runtime, invocation, cancellationToken),
            _ => throw Usage($"Unknown users subcommand '{positions[1]}'. Use list or show."),
        };
    }

    private static async Task<CliResult> ListUsersAsync(
        CliRuntime runtime,
        CliInvocation invocation,
        CancellationToken cancellationToken)
    {
        EnsureReadOnly(invocation, "users list", maximum: 2);
        return await UserCommands.ListAsync(runtime, cancellationToken);
    }

    private static async Task<CliResult> ShowUserAsync(
        CliRuntime runtime,
        CliInvocation invocation,
        CancellationToken cancellationToken)
    {
        EnsureReadOnly(invocation, "users show <id-or-username>", exact: 3);
        return await UserCommands.ShowAsync(runtime, invocation.Positionals[2], cancellationToken);
    }

    private static async Task<CliResult> DispatchSessionsAsync(
        CliRuntime runtime,
        CliInvocation invocation,
        CancellationToken cancellationToken)
    {
        var positions = invocation.Positionals;
        if (positions.Count < 2)
        {
            throw Usage("sessions needs a subcommand: list or revoke.");
        }

        var action = positions[1].ToLowerInvariant();
        if (action == "list")
        {
            EnsureSessionsList(invocation);
            return await SessionCommands.ListAsync(runtime, invocation.User, cancellationToken);
        }

        if (action != "revoke")
        {
            throw Usage($"Unknown sessions subcommand '{action}'. Use list or revoke.");
        }

        if (invocation.All)
        {
            if (positions.Count != 2 || invocation.User is null)
            {
                throw Usage("sessions revoke --all needs --user <id-or-username> and no session id.");
            }

            EnsureMutation(invocation, "sessions revoke --user <who> --all", exact: 2, allowStdin: false, allowAll: true);
            return await SessionCommands.RevokeAllAsync(runtime, invocation.User, cancellationToken);
        }

        if (invocation.User is not null)
        {
            throw Usage("--user is only for 'sessions list' or 'sessions revoke --all'.");
        }

        EnsureMutation(invocation, "sessions revoke <id>", exact: 3, allowStdin: false, allowAll: false);
        return await SessionCommands.RevokeAsync(runtime, positions[2], cancellationToken);
    }

    private static async Task<CliResult> DispatchSecurityAsync(
        CliRuntime runtime,
        CliInvocation invocation,
        CancellationToken cancellationToken)
    {
        var positions = invocation.Positionals;
        if (positions.Count < 2)
        {
            throw Usage("security needs a subcommand: show, methods, recover or unlink.");
        }

        var action = positions[1].ToLowerInvariant();
        switch (action)
        {
            case "show":
                EnsureReadOnly(invocation, "security show <id-or-username>", exact: 3);
                return await SecurityCommands.ShowAsync(runtime, positions[2], cancellationToken);

            case "methods":
                EnsureReadOnly(invocation, "security methods <id-or-username>", exact: 3);
                return await SecurityCommands.MethodsAsync(runtime, positions[2], cancellationToken);

            case "recover":
                if (positions.Count != 3 || invocation.Reason is null)
                {
                    throw Usage("security recover <id-or-username> --reason <text> [--yes]");
                }

                EnsureMutation(
                    invocation,
                    "security recover <id-or-username> --reason <text>",
                    exact: 3,
                    allowStdin: false,
                    allowAll: false);
                return await SecurityCommands.RecoverAsync(
                    runtime, positions[2], invocation.Reason, cancellationToken);

            case "unlink":
                if (positions.Count != 4)
                {
                    throw Usage("security unlink <id-or-username> <identity-id> [--yes]");
                }

                EnsureMutation(
                    invocation,
                    "security unlink <id-or-username> <identity-id>",
                    exact: 4,
                    allowStdin: false,
                    allowAll: false);
                return await SecurityCommands.UnlinkAsync(
                    runtime, positions[2], positions[3], cancellationToken);

            default:
                throw Usage($"Unknown security subcommand '{action}'. Use show, methods, recover or unlink.");
        }
    }

    private static void EnsureReadOnly(CliInvocation invocation, string usage, int exact = -1, int maximum = -1)
    {
        EnsureCount(invocation, value: exact >= 0 ? exact : 1, usage, maximum: maximum, exact: exact >= 0);
        Reject(invocation.Yes, "--yes", usage);
        Reject(invocation.Stdin, "--stdin", usage);
        Reject(invocation.All, "--all", usage);
        Reject(invocation.User is not null, "--user", usage);
        Reject(invocation.Reason is not null, "--reason", usage);
    }

    private static void EnsureSessionsList(CliInvocation invocation)
    {
        EnsureCount(invocation, value: 2, "sessions list", exact: true);
        Reject(invocation.Yes, "--yes", "sessions list");
        Reject(invocation.Stdin, "--stdin", "sessions list");
        Reject(invocation.All, "--all", "sessions list");
    }

    private static void EnsureMutation(
        CliInvocation invocation,
        string usage,
        int exact,
        bool allowStdin,
        bool allowAll)
    {
        EnsureCount(invocation, value: exact, usage, exact: true);
        Reject(invocation.Stdin && !allowStdin, "--stdin", usage);
        Reject(invocation.All && !allowAll, "--all", usage);
        Reject(invocation.User is not null && !usage.Contains("--user", StringComparison.Ordinal), "--user", usage);
        Reject(invocation.Reason is not null && !usage.Contains("--reason", StringComparison.Ordinal), "--reason", usage);
    }

    private static void EnsureCount(
        CliInvocation invocation,
        int value,
        string usage,
        int maximum = -1,
        bool exact = true)
    {
        var count = invocation.Positionals.Count;
        var valid = exact ? count == value : maximum >= 0 ? count <= maximum : true;
        if (!valid)
        {
            throw Usage($"Usage: stellarr {usage}");
        }
    }

    private static void Reject(bool present, string option, string usage)
    {
        if (present)
        {
            throw Usage($"{option} is not valid here. Usage: stellarr {usage}");
        }
    }

    private static CliException Usage(string message) => new("usage", message, CliExit.Usage);

    private static int WriteVersion(bool json, TextWriter output)
    {
        if (json)
        {
            output.WriteLine(JsonSerializer.Serialize(new
            {
                ok = true,
                command = "version",
                data = new { version = HelpText.Version },
            }, JsonOptions));
        }
        else
        {
            output.WriteLine(HelpText.Version);
        }

        return CliExit.Success;
    }

    private static int WriteHelp(bool json, string command, TextWriter output)
    {
        var text = string.IsNullOrEmpty(command) ? HelpText.Full : HelpText.ForCommand(command);
        if (json)
        {
            output.WriteLine(JsonSerializer.Serialize(new
            {
                ok = true,
                command = "help",
                data = new { topic = command, text },
            }, JsonOptions));
        }
        else
        {
            output.WriteLine(text);
        }

        return CliExit.Success;
    }

    private static void WriteResult(CliResult result, bool json, TextWriter output, TextWriter error)
    {
        if (json)
        {
            output.WriteLine(JsonSerializer.Serialize(new
            {
                ok = result.ExitCode == CliExit.Success,
                command = result.Command,
                exitCode = result.ExitCode,
                data = result.Data,
                warnings = result.Warnings ?? [],
            }, JsonOptions));
            return;
        }

        foreach (var line in result.Lines)
        {
            output.WriteLine(line);
        }

        foreach (var warning in result.Warnings ?? [])
        {
            error.WriteLine($"warning: {warning}");
        }
    }

    private static void WriteError(
        string code,
        string message,
        int exitCode,
        object? details,
        string command,
        bool json,
        TextWriter output,
        TextWriter error)
    {
        if (json)
        {
            output.WriteLine(JsonSerializer.Serialize(new
            {
                ok = false,
                command,
                exitCode,
                error = new
                {
                    code,
                    message,
                    details,
                },
            }, JsonOptions));
            return;
        }

        error.WriteLine($"error [{code}]: {message}");
    }

    private static (string Code, string Message, int ExitCode) MapDatabaseError(SqliteException exception)
    {
        var message = exception.Message;
        if (message.Contains("no such table", StringComparison.OrdinalIgnoreCase) ||
            message.Contains("no such column", StringComparison.OrdinalIgnoreCase))
        {
            return (
                "schema_incompatible",
                "The database schema is older than this CLI. Start the API once so it can upgrade it, then retry.",
                CliExit.Conflict);
        }

        return exception.SqliteErrorCode switch
        {
            5 or 6 => (
                "database_locked",
                "The database is busy or locked by another process. Try again when the API is less busy.",
                CliExit.Conflict),
            14 => (
                "database_unavailable",
                "The database file cannot be opened. Check the data volume and permissions.",
                CliExit.Unavailable),
            26 => (
                "database_unreadable",
                "The file is not a readable SQLite database.",
                CliExit.Conflict),
            _ => (
                "database_error",
                "The database operation failed. Nothing is reported as changed.",
                CliExit.Failure),
        };
    }
}
