using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;

namespace Stellarr.Cli;

internal static class CommandSupport
{
    internal static async Task<StellarrServer> RequireInstanceServerAsync(
        AppDbContext db,
        CancellationToken cancellationToken,
        bool tracked = false)
    {
        var query = tracked ? db.Servers : db.Servers.AsNoTracking();
        var server = await query
            .OrderBy(x => x.CreatedAt).ThenBy(x => x.Id)
            .FirstOrDefaultAsync(cancellationToken);
        return server ?? throw new CliException(
            "instance_not_found",
            "The database has no instance server yet. Finish setting up Stellarr through the web client first.",
            CliExit.NotFound);
    }

    internal static async Task<User> ResolveUserAsync(
        AppDbContext db,
        string idOrUsername,
        CancellationToken cancellationToken)
    {
        var value = idOrUsername.Trim();
        if (value.Length == 0)
        {
            throw new CliException("invalid_user", "An account id or username is required.", CliExit.Usage);
        }

        if (Guid.TryParse(value, out var id))
        {
            var byId = await db.Users.AsNoTracking().SingleOrDefaultAsync(x => x.Id == id, cancellationToken);
            return byId ?? throw UserNotFound(value);
        }

        var normalized = value.ToUpperInvariant();
        var byName = await db.Users.AsNoTracking()
            .SingleOrDefaultAsync(x => x.NormalizedUsername == normalized, cancellationToken);
        return byName ?? throw UserNotFound(value);
    }

    internal static CliException UserNotFound(string value) => new(
        "user_not_found",
        $"No account matches '{value}'.",
        CliExit.NotFound);

    internal static CliException SessionNotFound(string value) => new(
        "session_not_found",
        $"No active session matches '{value}'.",
        CliExit.NotFound);
}

internal sealed record ApiState(string Url, bool Available, int? StatusCode, string Detail);

internal static class LocalApi
{
    private static readonly TimeSpan ProbeTimeout = TimeSpan.FromSeconds(2);

    internal static async Task<ApiState> ProbeAsync(
        CliRuntime runtime,
        CancellationToken cancellationToken)
    {
        var configured = ContainerSettings.EnvironmentValue(runtime.Environment, "STELLARR_API_URL");
        var url = string.IsNullOrWhiteSpace(configured)
            ? "http://127.0.0.1:5000"
            : configured.Trim().TrimEnd('/');
        try
        {
            using var client = new HttpClient { Timeout = ProbeTimeout };
            using var response = await client.GetAsync($"{url}/health/ready", cancellationToken);
            return new ApiState(
                url,
                response.IsSuccessStatusCode,
                (int)response.StatusCode,
                response.IsSuccessStatusCode ? "ready" : $"HTTP {(int)response.StatusCode}");
        }
        catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException)
        {
            return new ApiState(url, false, null, "not reachable");
        }
    }
}
