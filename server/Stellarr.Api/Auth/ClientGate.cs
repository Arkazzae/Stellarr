using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Data;
using Stellarr.Api.Localization;

namespace Stellarr.Api.Auth;

/// <summary>Which clients an instance serves; bound from the <c>Clients</c> configuration section.</summary>
public sealed class ClientGateOptions
{
    public const string Section = "Clients";

    /// <summary>
    /// False lets a caller that does not name its client through, for an
    /// instance that wants to be reachable from a script.
    /// </summary>
    public bool RequireIdentification { get; set; } = true;

    /// <summary>
    /// The <c>X-Stellarr-Client</c> values this instance serves. Configuration
    /// binding appends to an array that already has elements, so kinds listed
    /// under <c>Clients:Allowed</c> are admitted next to these and never
    /// instead of them.
    /// </summary>
    public string[] Allowed { get; set; } = ["web", "cockpit", "desktop-linux", "mobile-android"];

    /// <summary>Where the current clients can be got; the refusal names it.</summary>
    public string? DownloadPath { get; set; } = "/";
}

/// <summary>
/// Admits only clients that belong to this project.
/// </summary>
/// <remarks>
/// <para>
/// This is an allow-list rather than a block-list. The browser build, the
/// operator panel, the desktop client and the Android client announce
/// themselves with <c>X-Stellarr-Client</c> and a version. Anything that does not is an
/// abandoned build of an earlier product, or code written against an API it
/// has no agreement with. Naming every bad build is impossible; naming the
/// good ones is not.
/// </para>
/// <para>
/// Only signing in and the calls a session starts with are gated. Refusing
/// those ends the session of a client that is not supported, and the rest of
/// the API is unreachable without one.
/// </para>
/// </remarks>
public static class ClientGate
{
    public const string KindHeader = "X-Stellarr-Client";
    public const string VersionHeader = "X-Stellarr-Client-Version";

    private const string DesktopKind = "desktop-linux";
    private const string UnsupportedClient = "unsupported-client";

    private static readonly string[] GatedPaths =
    [
        "/api/auth/login",
        "/api/auth/register",
        "/api/auth/desktop/browser/start",
        "/api/auth/desktop/browser/exchange",
        "/api/session",
        "/api/bootstrap",
    ];

    public static IApplicationBuilder UseClientGate(this IApplicationBuilder app)
    {
        var configuration = app.ApplicationServices.GetRequiredService<IConfiguration>();

        return app.Use(async (context, next) =>
        {
            if (IsGated(context.Request.Path))
            {
                // Bound on each gated request, so a changed appsettings file applies without a restart.
                var options = configuration.GetSection(ClientGateOptions.Section).Get<ClientGateOptions>()
                    ?? new ClientGateOptions();
                var messages = context.RequestServices.GetRequiredService<Messages>();
                if (await FindRefusalAsync(context, options, configuration, messages) is { } refusal)
                {
                    await refusal.ExecuteAsync(context);
                    return;
                }
            }

            await next(context);
        });
    }

    private static bool IsGated(PathString path) =>
        GatedPaths.Any(gated => path.Equals(gated, StringComparison.OrdinalIgnoreCase));

    private static async Task<IResult?> FindRefusalAsync(
        HttpContext context,
        ClientGateOptions options,
        IConfiguration configuration,
        Messages messages)
    {
        var kind = context.Request.Headers[KindHeader].ToString().Trim();
        if (kind.Length == 0)
        {
            return options.RequireIdentification
                ? Refuse(UnsupportedClient, messages.Get(MessageKey.ClientUnsupported), options)
                : null;
        }

        if (!options.Allowed.Contains(kind, StringComparer.OrdinalIgnoreCase))
        {
            return Refuse(UnsupportedClient, messages.Get(MessageKey.ClientUnsupported), options);
        }

        var reported = context.Request.Headers[VersionHeader].ToString().Trim();
        if (!Version.TryParse(reported, out var version))
        {
            return Refuse(UnsupportedClient, messages.Get(MessageKey.ClientVersionMissing), options);
        }

        // Only the desktop client has a floor to compare against.
        if (!kind.Equals(DesktopKind, StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        var minimum = await FindMinimumDesktopVersionAsync(context, configuration);
        return minimum is null || version >= minimum
            ? null
            : Refuse(
                "outdated-client",
                messages.Get(MessageKey.ClientOutdated, ("reported", reported), ("minimum", minimum)),
                options,
                minimum.ToString());
    }

    /// <summary>
    /// The floor that the client discovery document publishes as well: what
    /// the operator saved, else the configured default. Both places state the
    /// same number, so a client is never told it is current and then refused.
    /// </summary>
    private static async Task<Version?> FindMinimumDesktopVersionAsync(HttpContext context, IConfiguration configuration)
    {
        string? saved = null;
        try
        {
            saved = await context.RequestServices.GetRequiredService<AppDbContext>()
                .OperationsSettings.AsNoTracking()
                .OrderBy(x => x.ServerId)
                .Select(x => x.DesktopMinimumVersion)
                .FirstOrDefaultAsync(context.RequestAborted);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            // With no readable database nobody is signing in anyway, and the
            // endpoint behind the gate will fail by itself. A current client
            // must not be turned away because this lookup did.
        }

        var floor = string.IsNullOrWhiteSpace(saved) ? configuration["Desktop:MinimumVersion"] : saved;
        return Version.TryParse(floor?.Trim(), out var minimum) ? minimum : null;
    }

    private static IResult Refuse(string code, string title, ClientGateOptions options, string? minimumVersion = null)
    {
        var extensions = new Dictionary<string, object?> { ["code"] = code };
        if (minimumVersion is not null)
        {
            extensions["minimumVersion"] = minimumVersion;
        }

        if (!string.IsNullOrWhiteSpace(options.DownloadPath))
        {
            extensions["downloadPath"] = options.DownloadPath;
        }

        return Results.Problem(statusCode: StatusCodes.Status403Forbidden, title: title, extensions: extensions);
    }
}
