using System.Net.Mail;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Stellarr.Api.Auth;
using Stellarr.Api.Contracts;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;
using Stellarr.Api.Localization;
using Stellarr.Api.Mail;
using Stellarr.Api.Operations;
using Stellarr.Api.Secrets;

namespace Stellarr.Api.Endpoints;

// What the operator configures: instance settings, required client versions and mail.
public static partial class CockpitEndpoints
{
    private const int MaxMailAddressLength = InstanceSettingsService.MaxMailAddressLength;

    private static async Task<IResult> GetSettingsAsync(
        HttpContext http,
        AppDbContext db,
        IConfiguration configuration,
        InstanceSecrets secrets,
        CancellationToken cancellationToken)
    {
        var server = http.RequireInstanceServer();
        var settings = await InstanceSettingsService.LoadAsync(db, server, configuration, cancellationToken);
        return Results.Ok(settings.ToCockpitDto(
            server.Name,
            PublicUrlOf(configuration),
            await secrets.ReadAsync(cancellationToken)));
    }

    private static async Task<IResult> UpdateSettingsAsync(
        UpdateCockpitSettingsRequest request,
        HttpContext http,
        AppDbContext db,
        IConfiguration configuration,
        InstanceSecrets secrets,
        Messages messages,
        CancellationToken cancellationToken)
    {
        var server = http.RequireInstanceServer();
        var problems = InstanceSettingsService.Validate(request, messages);
        if (problems.Count > 0)
        {
            return Results.ValidationProblem(problems);
        }

        var settings = await InstanceSettingsService.LoadAsync(db, server, configuration, cancellationToken);
        InstanceSettingsService.Apply(settings, server, request);
        await StageAuditAsync(
            db,
            server.Id,
            http.User.RequireUserId(),
            messages.Get(MessageKey.AuditSettingsUpdated),
            cancellationToken);
        if (!await db.TrySaveChangesAsync(cancellationToken))
        {
            return Results.Conflict();
        }

        return Results.Ok(settings.ToCockpitDto(
            server.Name,
            PublicUrlOf(configuration),
            await secrets.ReadAsync(cancellationToken)));
    }

    private static async Task<IResult> GetDesktopReleaseAsync(
        HttpContext http,
        AppDbContext db,
        IConfiguration configuration,
        DesktopReleaseCatalogue desktop,
        AndroidReleaseCatalogue android,
        Messages messages,
        CancellationToken cancellationToken)
    {
        var settings = await InstanceSettingsService.LoadAsync(
            db, http.RequireInstanceServer(), configuration, cancellationToken);
        return DescribeReleases(
            settings, configuration, desktop, android, messages.Get(MessageKey.CockpitReleaseManifestBroken));
    }

    private static async Task<IResult> UpdateDesktopReleaseAsync(
        UpdateCockpitDesktopReleaseRequest request,
        HttpContext http,
        AppDbContext db,
        IConfiguration configuration,
        DesktopReleaseCatalogue desktop,
        AndroidReleaseCatalogue android,
        Messages messages,
        CancellationToken cancellationToken)
    {
        var server = http.RequireInstanceServer();
        var minimum = request.MinimumVersion?.Trim() ?? "";
        var recommended = request.RecommendedVersion?.Trim() ?? "";
        var problems = new Dictionary<string, string[]>(StringComparer.Ordinal);
        if (!DesktopReleaseEndpoints.TryParseStableVersion(minimum, out var minimumVersion))
        {
            problems["minimumVersion"] = [messages.Get(MessageKey.CockpitVersionInvalid)];
        }

        if (!DesktopReleaseEndpoints.TryParseStableVersion(recommended, out var recommendedVersion))
        {
            problems["recommendedVersion"] = [messages.Get(MessageKey.CockpitVersionInvalid)];
        }

        if (problems.Count == 0 && minimumVersion > recommendedVersion)
        {
            problems["recommendedVersion"] = [messages.Get(MessageKey.CockpitRecommendedBelowMinimum)];
        }

        if (problems.Count > 0)
        {
            return Results.ValidationProblem(problems);
        }

        var settings = await InstanceSettingsService.LoadAsync(db, server, configuration, cancellationToken);
        settings.DesktopMinimumVersion = minimum;
        settings.DesktopRecommendedVersion = recommended;
        settings.UpdatedAt = DateTime.UtcNow;
        await StageAuditAsync(
            db,
            server.Id,
            http.User.RequireUserId(),
            messages.Get(MessageKey.AuditDesktopVersionsSet, ("minimum", minimum), ("recommended", recommended)),
            cancellationToken);
        if (!await db.TrySaveChangesAsync(cancellationToken))
        {
            return Results.Conflict();
        }

        return DescribeReleases(
            settings,
            configuration,
            desktop,
            android,
            messages.Get(MessageKey.CockpitVersionsSavedManifestBroken));
    }

    private static async Task<IResult> SendTestMailAsync(
        TestMailRequest request,
        HttpContext http,
        AppDbContext db,
        IEmailDelivery delivery,
        IOptions<MailOptions> mail,
        InstanceSecrets secrets,
        IConfiguration configuration,
        Messages messages,
        CancellationToken cancellationToken)
    {
        var server = http.RequireInstanceServer();
        var recipient = request.To?.Trim() ?? "";
        if (recipient.Length > MaxMailAddressLength ||
            !MailAddress.TryCreate(recipient, out var parsed) ||
            !string.Equals(parsed.Address, recipient, StringComparison.OrdinalIgnoreCase))
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["to"] = [messages.Get(MessageKey.CockpitTestMailRecipientInvalid)],
            });
        }

        var settings = await InstanceSettingsService.LoadAsync(db, server, configuration, cancellationToken);
        var options = mail.Value;
        var transport = MailTransports.Resolve(settings, await secrets.ReadAsync(cancellationToken));
        var fromAddress = string.IsNullOrWhiteSpace(settings.MailFromAddress)
            ? options.FromAddress.Trim()
            : settings.MailFromAddress.Trim();
        if (!settings.MailingEnabled || fromAddress.Length == 0 || !transport.Ready)
        {
            return Results.Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: messages.Get(MessageKey.CockpitMailNotReadyTitle),
                detail: messages.Get(transport.Provider == MailProvider.Resend
                    ? MessageKey.CockpitMailNotReadyDetail
                    : MessageKey.CockpitMailNotReadySmtpDetail));
        }

        var from = string.IsNullOrWhiteSpace(options.FromName)
            ? fromAddress
            : $"{options.FromName.Trim()} <{fromAddress}>";
        try
        {
            var messageId = await delivery.SendAsync(
                AccountEmail.DeliveryTest(from, recipient, server.Name, messages),
                transport,
                cancellationToken);
            return Results.Ok(new { id = messageId, provider = MailTransports.NameOf(transport.Provider) });
        }
        catch (Exception exception) when (exception is MailDeliveryException or HttpRequestException)
        {
            return Results.Problem(
                statusCode: StatusCodes.Status502BadGateway,
                title: messages.Get(MessageKey.CockpitTestMailFailed),
                detail: exception.Message);
        }
    }

    /// <summary>
    /// The versions in force, with the packages published for download. A
    /// broken release manifest turns into a 503 that says what to repair.
    /// </summary>
    private static IResult DescribeReleases(
        OperationsSettings settings,
        IConfiguration configuration,
        DesktopReleaseCatalogue desktop,
        AndroidReleaseCatalogue android,
        string brokenManifestTitle)
    {
        try
        {
            return Results.Ok(new CockpitDesktopReleaseDto(
                ClientDiscoveryEndpoints.DesktopVersion(
                    settings.DesktopMinimumVersion, configuration, "Desktop:MinimumVersion"),
                ClientDiscoveryEndpoints.DesktopVersion(
                    settings.DesktopRecommendedVersion, configuration, "Desktop:RecommendedVersion"),
                desktop.Current()?.ToDto(),
                android.Current()?.ToDto()));
        }
        catch (InvalidDataException)
        {
            return Results.Problem(statusCode: StatusCodes.Status503ServiceUnavailable, title: brokenManifestTitle);
        }
    }

    /// <summary>
    /// The address people reach the instance at. It comes from the environment
    /// (STELLARR_DOMAIN, through the container's entrypoint) and nothing in
    /// Cockpit overrides it.
    /// </summary>
    internal static string PublicUrlOf(IConfiguration configuration) =>
        (configuration["Operations:PublicUrl"] ?? "").Trim().TrimEnd('/');
}
