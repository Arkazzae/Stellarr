namespace Stellarr.Cli;

/// <summary>A failure with a stable code and process exit status.</summary>
internal sealed class CliException(string code, string message, int exitCode, object? details = null) : Exception(message)
{
    internal string Code { get; } = code;

    internal int ExitCode { get; } = exitCode;

    internal object? Details { get; } = details;
}

/// <summary>One command's output, before it is written as text or JSON.</summary>
internal sealed record CliResult(
    string Command,
    object Data,
    IReadOnlyList<string> Lines,
    int ExitCode = CliExit.Success,
    IReadOnlyList<string>? Warnings = null);

/// <summary>The documented exit statuses. They are part of the CLI contract.</summary>
internal static class CliExit
{
    internal const int Success = 0;
    internal const int Failure = 1;
    internal const int Usage = 2;
    internal const int NotFound = 3;
    internal const int Conflict = 4;
    internal const int Unavailable = 5;

    internal static string NameOf(int code) => code switch
    {
        Success => "success",
        Failure => "failure",
        Usage => "usage",
        NotFound => "not_found",
        Conflict => "conflict",
        Unavailable => "unavailable",
        _ => "unknown",
    };
}
