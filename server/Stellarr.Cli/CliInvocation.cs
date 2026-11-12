namespace Stellarr.Cli;

/// <summary>
/// The small, explicit parser of this first release. It knows the handful of
/// global switches and leaves command validation to the command, so that
/// <c>stellarr help</c> can explain a mistake without opening a database.
/// </summary>
internal sealed class CliInvocation
{
    private static readonly HashSet<string> Flags = new(StringComparer.Ordinal)
    {
        "--json", "--yes", "-y", "--stdin", "--all", "--help", "-h", "--version",
    };

    private static readonly HashSet<string> Valued = new(StringComparer.Ordinal)
    {
        "--data-root", "--user",
    };

    private CliInvocation()
    {
    }

    internal List<string> Positionals { get; } = [];

    internal string? DataRoot { get; private set; }

    internal string? User { get; private set; }

    internal bool Json { get; private set; }

    internal bool Yes { get; private set; }

    internal bool Stdin { get; private set; }

    internal bool All { get; private set; }

    internal bool Help { get; private set; }

    internal bool Version { get; private set; }

    internal static CliInvocation Parse(string[] args)
    {
        var invocation = new CliInvocation();
        var optionsEnded = false;
        for (var index = 0; index < args.Length; index++)
        {
            var argument = args[index];
            if (!optionsEnded && argument == "--")
            {
                optionsEnded = true;
                continue;
            }

            if (!optionsEnded && argument.StartsWith('-') && argument != "-")
            {
                var equals = argument.IndexOf('=');
                var name = equals >= 0 ? argument[..equals] : argument;
                var inlineValue = equals >= 0 ? argument[(equals + 1)..] : null;
                if (Valued.Contains(name))
                {
                    var value = inlineValue ?? NextValue(args, ref index, name);
                    if (name == "--data-root")
                    {
                        if (string.IsNullOrWhiteSpace(value))
                        {
                            throw Usage("--data-root needs a non-empty path.");
                        }

                        invocation.DataRoot = value.Trim();
                    }
                    else
                    {
                        invocation.User = value;
                    }
                    continue;
                }

                if (Flags.Contains(name))
                {
                    if (inlineValue is not null)
                    {
                        throw Usage($"{name} does not take a value.");
                    }

                    switch (name)
                    {
                        case "--json": invocation.Json = true; break;
                        case "--yes" or "-y": invocation.Yes = true; break;
                        case "--stdin": invocation.Stdin = true; break;
                        case "--all": invocation.All = true; break;
                        case "--help" or "-h": invocation.Help = true; break;
                        case "--version": invocation.Version = true; break;
                    }
                    continue;
                }

                throw Usage($"Unknown option '{name}'.");
            }

            invocation.Positionals.Add(argument);
        }

        return invocation;
    }

    /// <summary>Whether --json appeared, even when parsing later failed.</summary>
    internal static bool JsonRequested(string[] args) =>
        args.Any(argument => argument == "--json" || argument.StartsWith("--json=", StringComparison.Ordinal));

    private static string NextValue(string[] args, ref int index, string name)
    {
        if (index + 1 >= args.Length)
        {
            throw Usage($"{name} needs a value.");
        }

        var next = args[index + 1];
        if (next.StartsWith('-') && next != "-")
        {
            // Do not swallow the next option as a value. A deliberately
            // dash-prefixed value still has the explicit --name=value form.
            throw Usage($"{name} needs a value; '{next}' looks like another option.");
        }

        index++;
        return next;
    }

    private static CliException Usage(string message) =>
        new("usage", message, CliExit.Usage);
}
