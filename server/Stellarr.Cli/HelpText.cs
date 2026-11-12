using System.Reflection;

namespace Stellarr.Cli;

internal static class HelpText
{
    internal static string Version =>
        typeof(HelpText).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion
        ?? typeof(HelpText).Assembly.GetName().Version?.ToString()
        ?? "unknown";

    internal static string Full => $"""
        stellarr {Version} - operator CLI for a Stellarr container

        Usage:
          stellarr [global options] <command> [arguments]

        Commands:
          help [command]                 Show this help, or help for one command.
          version                        Print the CLI version.
          status                         Show database, instance and local API state.
          doctor                         Check the data volume, schema, keys, disk and local API.
          config list                    List effective settings, sources and editability.
          config get <key>               Show one effective setting.
          config set <key> <value>       Store one database-backed setting.
          config validate                Validate the stored configuration without saving.
          secrets list                   List secret names, state, source and update time.
          secrets set <name> --stdin     Store an encrypted secret from stdin (or a hidden prompt).
          secrets clear <name>           Remove the stored override and fall back to the environment.
          users list                     List accounts (limited, no hashes or tokens).
          users show <id-or-username>    Show one account.
          sessions list [--user <who>]   List active sessions (limited, no cookies or tokens).
          sessions revoke <id>           Revoke one durable session.
          sessions revoke --user <who> --all
                                         Revoke every session of an account and pending handoffs.
          security show <id-or-username> Show MFA methods, trust, sessions and recent security events.
          security methods <id-or-username>
                                         List security-method metadata only.
          security recover <id-or-username> --reason <text>
                                         Revoke security and issue one enrollment-only recovery credential.
          security unlink <id-or-username> <identity-id>
                                         Remove one identity-provider link from an account.

        Global options:
          --data-root <path>   Data root holding db/stellarr.db and keys/.
                               Default: STELLARR_DATA_ROOT, DataRoot, or /data/stellarr.
          --json               Emit one parseable JSON document. Errors use stable codes.
          --yes, -y            Confirm a mutation without prompting. Required when stdin is closed.
          --help, -h           Show help. Does not open the database.

        Mutation rules:
          Without --yes, a change is previewed and confirmed. A closed stdin fails instead
          of waiting. Invalid arguments, a refused confirmation or Ctrl+C change nothing.
          Secret values are accepted only from --stdin or a hidden prompt, never as an argument.

        Exit statuses:
          0  success
          1  unexpected failure or an unhealthy status/doctor result
          2  invalid usage, invalid value, refused confirmation or cancellation
          3  not found (database, user, session or setting)
          4  conflict, read-only setting or an incompatible schema
          5  unavailable (reserved for a database that cannot be opened)

        Safety:
          The CLI never creates the database, runs migrations or seeds an instance. A new
          schema is installed by a normal API start. Mutations write an operator audit entry
          as local-cli in the same transaction. Secret values, hashes, cookies and tokens are
          never printed, except a newly issued MFA recovery credential, which is shown once.
          Session revocation also closes matching WebSocket connections within one second;
          voice and media are torn down by the normal disconnect lifecycle.

        Typical use:
          docker compose exec stellarr stellarr doctor
          docker compose exec stellarr stellarr config list
          docker compose exec stellarr stellarr config set time-zone Europe/Warsaw --yes
          printf '%s\n' "$SECRET" | docker compose exec -T stellarr stellarr secrets set mail.smtp-password --stdin --yes
          docker compose stop && docker compose run --rm --entrypoint stellarr stellarr status
        """;

    internal static string ForCommand(string command) => command switch
    {
        "status" => "Usage: stellarr status [--json]\n\nShows whether the database, required schema, data root and local API are available.",
        "doctor" => "Usage: stellarr doctor [--json]\n\nChecks the existing data volume without modifying it: database and schema, data/keys directories, free space and the local API. The API probe is short and may be unavailable when the instance is stopped.",
        "config" => """
            Usage:
              stellarr config list [--json]
              stellarr config get <key> [--json]
              stellarr config set <key> <value> [--yes] [--json]
              stellarr config validate [--json]

            Database-backed keys:
              instance.name, time-zone, mail.enabled, mail.from-address,
              mail.smtp.host, mail.smtp.port, mail.smtp.username, mail.smtp.security,
              mail.resend.enabled, mail.invites.enabled, mail.recovery.enabled,
              mail.alerts.enabled, giphy.enabled, retention.backups-days,
              retention.logs-days, retention.orphans-days, cleanup.enabled,
              mfa.requirement, mfa.trusted-device-days, mfa.challenge-minutes,
              mfa.email-code-minutes, mfa.email-cooldown-seconds, mfa.email-attempts,
              mfa.email-sends-per-hour, mfa.cli-recovery-minutes

            Startup keys are read-only; change them in .env/Compose and recreate the
            container. `config list` names them with their environment variables.
            """,
        "secrets" => """
            Usage:
              stellarr secrets list [--json]
              stellarr secrets set <name> --stdin --yes [--json]
              stellarr secrets set <name> [--yes] [--json]   (hidden prompt when interactive)
              stellarr secrets clear <name> [--yes] [--json]

            Secret names:
              mail.smtp-password, mail.resend-api-key, giphy.api-key

            A secret is never accepted as a positional argument. `list` never prints values.
            The database override wins over the environment; `clear` removes the override
            and explains the environment fallback.
            """,
        "users" => "Usage:\n  stellarr users list [--json]\n  stellarr users show <id-or-username> [--json]\n\nLists are limited and never include password hashes, sessions or tokens.",
        "sessions" => """
            Usage:
              stellarr sessions list [--user <id-or-username>] [--json]
              stellarr sessions revoke <id> [--yes] [--json]
              stellarr sessions revoke --user <id-or-username> --all [--yes] [--json]

            Revocation updates the durable session records. Revoking all sessions also
            invalidates approved desktop browser handoffs not yet redeemed. The API
            closes matching WebSocket connections within one second, and the normal
            disconnect lifecycle closes their voice and media sessions.
            """,
        "security" => """
            Usage:
              stellarr security show <id-or-username> [--json]
              stellarr security methods <id-or-username> [--json]
              stellarr security recover <id-or-username> --reason <text> [--yes] [--json]
              stellarr security unlink <id-or-username> <identity-id> [--yes] [--json]

            `show` inspects methods, trusted devices, active sessions and recent events
            without printing seeds, hashes or codes. `recover` atomically revokes methods,
            trust, sessions and approved handoffs, then prints one short-lived recovery
            credential once. That credential can only enroll replacement security through
            POST /api/auth/recovery/redeem; it never grants an ordinary session or disables
            an enforced policy. Disabled accounts stay disabled. A recovery keeps the
            account's identity-provider links; `show` lists them and `unlink` removes one.
            """,
        _ => Full,
    };
}
