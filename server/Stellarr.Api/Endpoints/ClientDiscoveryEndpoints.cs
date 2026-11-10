using System.Reflection;
using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Data;
using Stellarr.Api.Realtime;

namespace Stellarr.Api.Endpoints;

/// <summary>
/// The id by which a client recognises this instance. It is given by
/// <c>Stellarr:InstanceId</c> or, failing that, generated on the first start
/// and kept in the data root, so it survives restarts and new containers.
/// </summary>
public sealed class ClientDiscoveryIdentity
{
    private const string FileName = "instance-id";

    private ClientDiscoveryIdentity(Guid instanceId) => InstanceId = instanceId;

    public Guid InstanceId { get; }

    public static ClientDiscoveryIdentity Load(IConfiguration configuration)
    {
        if (configuration["Stellarr:InstanceId"]?.Trim() is { Length: > 0 } configured)
        {
            return Guid.TryParse(configured, out var configuredId)
                ? new ClientDiscoveryIdentity(configuredId)
                : throw new InvalidOperationException("Stellarr:InstanceId must be a UUID.");
        }

        var dataRoot = configuration["DataRoot"] ?? "data";
        Directory.CreateDirectory(dataRoot);
        var path = Path.Combine(dataRoot, FileName);
        return new ClientDiscoveryIdentity(File.Exists(path) ? ReadStored(path) : Store(path));
    }

    private static Guid ReadStored(string path) =>
        Guid.TryParse(File.ReadAllText(path).Trim(), out var id)
            ? id
            : throw new InvalidOperationException($"{path} does not contain a valid instance UUID.");

    // The file appears complete or not at all, and when two processes start
    // together the one that arrives second adopts the id of the first.
    private static Guid Store(string path)
    {
        var id = Guid.NewGuid();
        var temporary = $"{path}.{id:N}.tmp";
        File.WriteAllText(temporary, id.ToString());
        try
        {
            File.Move(temporary, path, overwrite: false);
            return id;
        }
        catch (IOException) when (File.Exists(path))
        {
            File.Delete(temporary);
            return ReadStored(path);
        }
    }
}

/// <summary>
/// The anonymous document a native client reads before it signs in, to learn
/// which instance it is talking to and whether the two are compatible.
/// </summary>
public static class ClientDiscoveryEndpoints
{
    private const int ApiProtocol = 1;
    private const string FallbackInstanceName = "Stellarr";
    private const string FallbackDesktopVersion = "0.1.0";
    private static readonly string[] SignInMethods = ["password", "invite"];

    private sealed record DiscoveryDocument(
        string Product,
        Guid InstanceId,
        string InstanceName,
        string CanonicalOrigin,
        string ServerVersion,
        string? BuildSha,
        int ApiProtocol,
        int ApiProtocolMin,
        int ApiProtocolMax,
        int RtcProtocol,
        IReadOnlyList<string> Auth,
        DesktopVersions Desktop);

    private sealed record DesktopVersions(string MinimumVersion, string RecommendedVersion);

    public static IEndpointRouteBuilder MapClientDiscoveryEndpoints(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/.well-known/stellarr/client", DescribeAsync);
        return endpoints;
    }

    private static async Task<IResult> DescribeAsync(
        HttpContext http,
        IConfiguration configuration,
        ClientDiscoveryIdentity identity,
        AppDbContext db,
        CancellationToken cancellationToken)
    {
        var server = await db.Servers.AsNoTracking()
            .OrderBy(x => x.CreatedAt)
            .ThenBy(x => x.Id)
            .Select(x => new { x.Id, x.Name })
            .FirstOrDefaultAsync(cancellationToken);
        var saved = server is null
            ? null
            : await db.OperationsSettings.AsNoTracking()
                .Where(x => x.ServerId == server.Id)
                .Select(x => new { x.DesktopMinimumVersion, x.DesktopRecommendedVersion })
                .SingleOrDefaultAsync(cancellationToken);

        return Results.Ok(new DiscoveryDocument(
            Product: "stellarr",
            InstanceId: identity.InstanceId,
            InstanceName: server?.Name ?? Setting(configuration, "Stellarr:InstanceName") ?? FallbackInstanceName,
            CanonicalOrigin: CanonicalOrigin(http, configuration),
            ServerVersion: ServerVersion(),
            BuildSha: Setting(configuration, "Build:Sha"),
            ApiProtocol: ApiProtocol,
            ApiProtocolMin: ApiProtocol,
            ApiProtocolMax: ApiProtocol,
            RtcProtocol: RtcProtocol.Version,
            Auth: SignInMethods,
            Desktop: new DesktopVersions(
                DesktopVersion(saved?.DesktopMinimumVersion, configuration, "Desktop:MinimumVersion"),
                DesktopVersion(saved?.DesktopRecommendedVersion, configuration, "Desktop:RecommendedVersion"))));
    }

    private static string CanonicalOrigin(HttpContext http, IConfiguration configuration)
    {
        if (Setting(configuration, "Desktop:CanonicalOrigin") is not { } configured)
        {
            var request = http.Request;
            return $"{request.Scheme}://{request.Host}{request.PathBase}".TrimEnd('/');
        }

        if (!Uri.TryCreate(configured, UriKind.Absolute, out var origin) ||
            origin.Scheme is not ("http" or "https") ||
            origin.UserInfo.Length > 0 ||
            origin.Query.Length > 0 ||
            origin.Fragment.Length > 0)
        {
            throw new InvalidOperationException(
                "Desktop:CanonicalOrigin must be an absolute HTTP(S) origin without credentials, query or fragment.");
        }

        return origin.GetLeftPart(UriPartial.Authority);
    }

    private static string ServerVersion()
    {
        var assembly = typeof(ClientDiscoveryEndpoints).Assembly;
        var informational = assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion;
        // The informational version carries the source revision after a plus sign.
        return informational?.Split('+', 2)[0] ?? assembly.GetName().Version?.ToString(3) ?? "0.0.0";
    }

    /// <summary>What the operator saved wins over the configured default.</summary>
    internal static string DesktopVersion(string? saved, IConfiguration configuration, string key) =>
        Trimmed(saved) ?? Setting(configuration, key) ?? FallbackDesktopVersion;

    private static string? Setting(IConfiguration configuration, string key) => Trimmed(configuration[key]);

    private static string? Trimmed(string? value) => value?.Trim() is { Length: > 0 } text ? text : null;
}
