using System.Globalization;
using Microsoft.Extensions.Configuration;

namespace Stellarr.Cli;

internal sealed record StartupContext(
    IConfiguration Configuration,
    IReadOnlyDictionary<string, string?> Environment);

/// <summary>A read-only startup setting with the source of the value we print.</summary>
internal sealed record StartupValue(string Value, string Source);

/// <summary>
/// Resolves the values the container entrypoint would export before the API
/// starts. <c>docker exec</c> inherits the Compose environment but not those
/// exports, so the CLI repeats the entrypoint's public-address, media and storage
/// rules from the raw variables instead of showing the API defaults.
/// </summary>
internal static class ContainerSettings
{
    internal static string? EnvironmentValue(
        IReadOnlyDictionary<string, string?> environment,
        string name) =>
        environment.TryGetValue(name, out var value) && !string.IsNullOrEmpty(value) ? value : null;

    internal static StartupValue PublicUrl(StartupContext context)
    {
        var explicitUrl = EnvironmentValue(context.Environment, "STELLARR_PUBLIC_URL");
        var domain = EnvironmentValue(context.Environment, "STELLARR_DOMAIN") ??
            EnvironmentValue(context.Environment, "PUBLIC_HOST");
        if (domain is null && explicitUrl is null)
        {
            var configured = context.Configuration["Operations:PublicUrl"];
            return string.IsNullOrEmpty(configured)
                ? new StartupValue("", "unavailable")
                : new StartupValue(configured.TrimEnd('/'), "configuration");
        }

        if (explicitUrl is not null)
        {
            return new StartupValue(explicitUrl.TrimEnd('/'), "environment");
        }

        var httpsPort = EnvironmentValue(context.Environment, "PUBLIC_HTTPS_PORT") ?? "443";
        var publicPort = EnvironmentValue(context.Environment, "STELLARR_PUBLIC_PORT") ?? httpsPort;
        return new StartupValue(PublicUrlFor(domain!, publicPort), "environment");
    }

    internal static StartupValue PublicHost(StartupContext context)
    {
        var domain = EnvironmentValue(context.Environment, "STELLARR_DOMAIN") ??
            EnvironmentValue(context.Environment, "PUBLIC_HOST");
        return domain is null
            ? new StartupValue("localhost", "entrypoint")
            : new StartupValue(domain, "environment");
    }

    internal static StartupValue HttpsPort(StartupContext context)
    {
        // The entrypoint reads PUBLIC_HTTPS_PORT. STELLARR_HTTPS_PORT is only
        // the host-side Compose substitution that normally produces it.
        var value = EnvironmentValue(context.Environment, "PUBLIC_HTTPS_PORT");
        return value is null
            ? new StartupValue("443", "default")
            : new StartupValue(value, "environment");
    }

    internal static StartupValue ConfigValue(
        StartupContext context,
        string key,
        string fallback,
        params string[] environmentNames)
    {
        var value = context.Configuration[key];
        if (value is not null)
        {
            return new StartupValue(
                value,
                environmentNames.Any(name => EnvironmentValue(context.Environment, name) is not null)
                    ? "environment"
                    : "configuration");
        }

        return new StartupValue(fallback, "default");
    }

    /// <summary>
    /// The named identity providers, by id, each marked when the instance
    /// trusts its own second step. Only ids and that flag: never a secret.
    /// </summary>
    internal static StartupValue OidcProviders(StartupContext context)
    {
        var providers = context.Configuration.GetSection("Oidc:Providers").GetChildren()
            .OrderBy(x => x.Key, StringComparer.Ordinal)
            .Select(x => string.Equals(x["TrustProviderMfa"], "true", StringComparison.OrdinalIgnoreCase)
                ? $"{x.Key} (trusts provider MFA)"
                : x.Key)
            .ToArray();
        if (providers.Length == 0)
        {
            return new StartupValue("(none)", "default");
        }

        var fromEnvironment = context.Environment.Keys.Any(
            name => name.StartsWith("Oidc__Providers__", StringComparison.OrdinalIgnoreCase));
        return new StartupValue(string.Join(", ", providers), fromEnvironment ? "environment" : "configuration");
    }

    internal static StartupValue EnvironmentOrConfig(
        StartupContext context,
        string environmentName,
        string configKey,
        string fallback)
    {
        var value = EnvironmentValue(context.Environment, environmentName) ??
            context.Configuration[configKey];
        if (value is null)
        {
            return new StartupValue(fallback, "default");
        }

        return new StartupValue(
            value,
            EnvironmentValue(context.Environment, environmentName) is not null
                ? "environment"
                : "configuration");
    }

    /// <summary>
    /// The entrypoint always points the API and RustFS at the loopback object
    /// store, overriding any Storage__Endpoint from Compose. The display says so
    /// instead of pretending that variable can change the address.
    /// </summary>
    internal static StartupValue StorageEndpoint() => new("http://127.0.0.1:9000", "entrypoint");

    internal static StartupValue StorageBucket(StartupContext context)
    {
        // The entrypoint always exports Storage__Bucket from RUSTFS_BUCKET or
        // its own default, overwriting any Storage__Bucket from Compose.
        var bucket = EnvironmentValue(context.Environment, "RUSTFS_BUCKET");
        return bucket is null
            ? new StartupValue("stellarr-images", "default")
            : new StartupValue(bucket, "environment");
    }

    private static string PublicUrlFor(string host, string publicPort)
    {
        // The shell wraps any host containing a colon, matching the entrypoint.
        var displayHost = host.Contains(':', StringComparison.Ordinal) ? $"[{host}]" : host;
        var port = int.TryParse(publicPort, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed)
            ? parsed
            : 443;
        return port == 443
            ? $"https://{displayHost}"
            : $"https://{displayHost}:{port.ToString(CultureInfo.InvariantCulture)}";
    }
}
