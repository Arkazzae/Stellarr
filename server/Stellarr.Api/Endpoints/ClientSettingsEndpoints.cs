using System.Security.Claims;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Auth;
using Stellarr.Api.Contracts;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;
using Stellarr.Api.Localization;

namespace Stellarr.Api.Endpoints;

/// <summary>
/// The client's own settings for the signed-in account: the theme, the
/// language, the call shortcuts and the voice processing, so they follow the
/// person to every device instead of staying in one browser.
/// </summary>
/// <remarks>
/// Each section is replaced whole, so two devices saving different sections
/// never overwrite each other, and a section is the unit a device last wrote.
/// The fields inside belong to the client, which normalises them on read: an
/// older or newer build may have written them.
/// </remarks>
public static class ClientSettingsEndpoints
{
    public static IEndpointRouteBuilder MapClientSettingsEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var settings = endpoints.MapGroup("/api/me/settings").RequireAuthorization();
        settings.MapGet("", GetAsync);
        settings.MapPut("/{section}", SaveAsync);
        return endpoints;
    }

    private static async Task<IResult> GetAsync(
        ClaimsPrincipal principal,
        AppDbContext db,
        CancellationToken cancellationToken)
    {
        var userId = principal.RequireUserId();
        var preferences = await db.UserPreferences.AsNoTracking()
            .SingleOrDefaultAsync(x => x.UserId == userId, cancellationToken);
        return Results.Ok(new ClientSettingsDto(
            Parse(ClientSettings.Read(preferences, "appearance")),
            Parse(ClientSettings.Read(preferences, "language")),
            Parse(ClientSettings.Read(preferences, "keybinds")),
            Parse(ClientSettings.Read(preferences, "voice"))));
    }

    private static async Task<IResult> SaveAsync(
        string section,
        HttpRequest request,
        ClaimsPrincipal principal,
        Messages messages,
        AppDbContext db,
        CancellationToken cancellationToken)
    {
        if (!ClientSettings.Sections.Contains(section))
        {
            return Results.NotFound();
        }

        var json = await ReadObjectAsync(request, cancellationToken);
        if (json is null)
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                [section] = [messages.Get(MessageKey.ClientSettingsInvalid, ("max", ClientSettings.MaxLength))],
            });
        }

        var userId = principal.RequireUserId();
        var preferences = await db.UserPreferences.SingleOrDefaultAsync(x => x.UserId == userId, cancellationToken);
        if (preferences is not null)
        {
            // Only this section's column is written, so devices saving other
            // sections at the same moment do not undo each other.
            ClientSettings.Write(preferences, section, json);
            await db.SaveChangesAsync(cancellationToken);
            return Results.NoContent();
        }

        try
        {
            preferences = new UserPreferenceSettings { UserId = userId };
            ClientSettings.Write(preferences, section, json);
            db.UserPreferences.Add(preferences);
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException)
        {
            // A client sends every section at once on its first sign-in, so
            // another request may have created the row in between. It exists
            // now: write this section into it.
            db.ChangeTracker.Clear();
            preferences = await db.UserPreferences.SingleAsync(x => x.UserId == userId, cancellationToken);
            ClientSettings.Write(preferences, section, json);
            await db.SaveChangesAsync(cancellationToken);
        }

        return Results.NoContent();
    }

    /// <summary>
    /// The body as compact JSON when it is one object within the size limit,
    /// otherwise null. Read by hand rather than bound, so an oversized body is
    /// refused before it is parsed and a non-object never reaches the row.
    /// </summary>
    private static async Task<string?> ReadObjectAsync(HttpRequest request, CancellationToken cancellationToken)
    {
        if (request.ContentLength > ClientSettings.MaxLength * 4)
        {
            return null;
        }

        using var reader = new StreamReader(request.Body);
        var buffer = new char[ClientSettings.MaxLength * 4 + 1];
        var read = await reader.ReadBlockAsync(buffer.AsMemory(), cancellationToken);
        if (read > ClientSettings.MaxLength * 4)
        {
            return null;
        }

        try
        {
            using var document = JsonDocument.Parse(buffer.AsMemory(0, read));
            if (document.RootElement.ValueKind != JsonValueKind.Object)
            {
                return null;
            }

            // Stored compact, so the limit measures the settings and not the
            // whitespace a client happened to send.
            var compact = JsonSerializer.Serialize(document.RootElement);
            return compact.Length <= ClientSettings.MaxLength ? compact : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    /// <summary>A damaged section reads as never saved instead of failing the whole answer.</summary>
    private static JsonElement? Parse(string? json)
    {
        if (string.IsNullOrEmpty(json))
        {
            return null;
        }

        try
        {
            using var document = JsonDocument.Parse(json);
            return document.RootElement.ValueKind == JsonValueKind.Object ? document.RootElement.Clone() : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }
}
