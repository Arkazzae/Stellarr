using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Auth;
using Stellarr.Api.Auth.Security;
using Stellarr.Api.Contracts;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;
using Stellarr.Api.Localization;
using Stellarr.Api.Realtime;

namespace Stellarr.Api.Endpoints;

/// <summary>The signed-in account: its profile, preferences, arrival sound and password.</summary>
public static class AccountEndpoints
{
    private const int DisplayNameMaxLength = 64;
    private const int CustomStatusMaxLength = 128;
    private const int BioMaxLength = 2000;
    private const int PronounsMaxLength = 32;

    public static IEndpointRouteBuilder MapAccountEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var account = endpoints.MapGroup("/api/me").RequireAuthorization();
        account.MapGet("", GetAccountAsync);
        account.MapPatch("", UpdateAccountAsync);
        account.MapPatch("/preferences", UpdatePreferencesAsync);
        account.MapGet("/join-sound", GetJoinSoundLibraryAsync);
        account.MapPost("/password", ChangePasswordAsync).RequireRateLimiting(RateLimitPolicies.Login);
        return endpoints;
    }

    internal static async Task<User> FindCurrentAsync(
        ClaimsPrincipal principal,
        AppDbContext db,
        CancellationToken cancellationToken)
    {
        var userId = principal.RequireUserId();
        return await db.Users.Include(x => x.Preferences).SingleAsync(x => x.Id == userId, cancellationToken);
    }

    /// <summary>
    /// Tells everybody the profile changed, and the account's own connections
    /// the same with the presence they see for themselves.
    /// </summary>
    internal static async Task BroadcastUserUpdatedAsync(
        IHubContext<AppHub> hub,
        PresenceTracker presence,
        User user,
        CancellationToken cancellationToken)
    {
        await hub.Clients.All.SendAsync(
            "UserUpdated",
            user.ToDto(presence.PublicPresenceOf(user.Id)),
            cancellationToken);
        await hub.Clients.Group(AppHub.UserGroup(user.Id)).SendAsync(
            "UserUpdated",
            user.ToDto(presence.PresenceOf(user.Id)),
            cancellationToken);
    }

    private static async Task<IResult> GetAccountAsync(
        ClaimsPrincipal principal,
        AppDbContext db,
        CancellationToken cancellationToken) =>
        Results.Ok((await FindCurrentAsync(principal, db, cancellationToken)).ToAccountDto());

    private static async Task<IResult> UpdateAccountAsync(
        UpdateAccountRequest request,
        ClaimsPrincipal principal,
        Messages messages,
        AppDbContext db,
        IHubContext<AppHub> hub,
        PresenceTracker presence,
        CancellationToken cancellationToken)
    {
        if (request.Email is not null)
        {
            return Invalid("email", messages.Get(MessageKey.RecoveryEmailChangeDisabled));
        }

        var errors = ValidateProfile(request, messages);
        if (errors.Count > 0)
        {
            return Results.ValidationProblem(errors);
        }

        var user = await FindCurrentAsync(principal, db, cancellationToken);
        if (request.DisplayName is not null)
        {
            user.DisplayName = request.DisplayName.Trim();
        }

        // Clearing a field stores nothing rather than an empty string.
        if (request.CustomStatus is not null)
        {
            user.CustomStatus = BlankToNull(request.CustomStatus);
        }

        if (request.Bio is not null)
        {
            user.Bio = BlankToNull(request.Bio);
        }

        if (request.Pronouns is not null)
        {
            user.Pronouns = BlankToNull(request.Pronouns);
        }

        await db.SaveChangesAsync(cancellationToken);
        await BroadcastUserUpdatedAsync(hub, presence, user, cancellationToken);
        return Results.Ok(user.ToAccountDto());
    }

    /// <summary>
    /// Every soundboard sound this account may announce its arrivals with,
    /// grouped by the server it belongs to.
    /// </summary>
    /// <remarks>
    /// Deliberately not the active server's soundboard: the choice is personal
    /// and travels with the person into every call, so the whole membership is
    /// the catalogue. A server with no sounds is left out rather than shown
    /// empty; a selection whose server has since been left is still reported,
    /// because saying nothing would look like the setting had cleared itself.
    /// </remarks>
    private static async Task<IResult> GetJoinSoundLibraryAsync(
        ClaimsPrincipal principal,
        AppDbContext db,
        CancellationToken cancellationToken)
    {
        var userId = principal.RequireUserId();
        var serverIds = await MemberServerIdsAsync(db, userId, cancellationToken);
        var servers = await db.Servers.AsNoTracking()
            .Where(x => serverIds.Contains(x.Id))
            .OrderBy(x => x.Name)
            .ToArrayAsync(cancellationToken);
        var sounds = await db.SoundboardSounds.AsNoTracking()
            .Where(x => serverIds.Contains(x.ServerId))
            .OrderBy(x => x.Position)
            .ThenBy(x => x.CreatedAt)
            .Include(x => x.Attachment)
            .ToArrayAsync(cancellationToken);
        var selectedId = await db.UserPreferences.AsNoTracking()
            .Where(x => x.UserId == userId)
            .Select(x => x.JoinSoundId)
            .SingleOrDefaultAsync(cancellationToken);

        var offered = servers
            .Select(server => new JoinSoundServerDto(
                server.Id.ToString(),
                server.Name,
                server.IconUrl,
                sounds.Where(sound => sound.ServerId == server.Id).Select(sound => sound.ToJoinSoundDto()).ToArray()))
            .Where(group => group.Sounds.Count > 0)
            .ToArray();
        return Results.Ok(new JoinSoundLibraryDto(JoinSound.MaxSeconds, selectedId?.ToString(), offered));
    }

    private static async Task<IResult> UpdatePreferencesAsync(
        UpdatePreferencesRequest request,
        ClaimsPrincipal principal,
        Messages messages,
        AppDbContext db,
        IHubContext<AppHub> hub,
        PresenceTracker presence,
        CancellationToken cancellationToken)
    {
        if (request.VadSensitivity is < 0 or > 100)
        {
            return Invalid("vadSensitivity", messages.Get(MessageKey.VadSensitivityRange));
        }

        var userId = principal.RequireUserId();

        // Resolved before anything is written: an arrival may only be announced
        // with a sound this account can already play, which is a question for
        // the database rather than for the client that sent the id.
        Guid? joinSoundId = null;
        if (request.JoinSoundId?.Trim() is { Length: > 0 } requestedSound)
        {
            if (!Guid.TryParse(requestedSound, out var soundId) ||
                !await CanPlaySoundAsync(db, userId, soundId, cancellationToken))
            {
                return Invalid("joinSoundId", messages.Get(MessageKey.JoinSoundNotAvailable));
            }

            joinSoundId = soundId;
        }

        var preferences = await db.UserPreferences.SingleOrDefaultAsync(x => x.UserId == userId, cancellationToken);
        if (preferences is null)
        {
            preferences = new UserPreferenceSettings { UserId = userId };
            db.UserPreferences.Add(preferences);
        }

        Apply(request, preferences);
        // An empty string is how the picker says "back to the shared chime";
        // an absent field, like every other one, changes nothing.
        if (request.JoinSoundId is not null)
        {
            preferences.JoinSoundId = joinSoundId;
        }

        await db.SaveChangesAsync(cancellationToken);
        if (request.ShowPresence is { } showPresence && presence.SetVisibility(userId, showPresence))
        {
            await BroadcastPresenceAsync(hub, presence, db, userId, cancellationToken);
        }

        return Results.Ok(preferences.ToDto());
    }

    private static async Task<IResult> ChangePasswordAsync(
        ChangePasswordRequest request,
        ClaimsPrincipal principal,
        AppDbContext db,
        PasswordService passwords,
        Messages messages,
        HttpContext context,
        CancellationToken cancellationToken)
    {
        if (PasswordPolicy.IsTooShort(request.NewPassword))
        {
            return Outcome("too-short");
        }

        if (PasswordPolicy.IsTooLong(request.NewPassword))
        {
            return Invalid("newPassword", messages.Get(MessageKey.NewPasswordTooLong, ("max", PasswordPolicy.MaxLength)));
        }

        var user = await FindCurrentAsync(principal, db, cancellationToken);
        // Checked before the password, so a stolen session cannot use this
        // form to try passwords on an account that has a second step.
        if (!await MfaPolicy.HasFreshSecondStepAsync(db, user.Id, principal.FindSessionId(), cancellationToken))
        {
            return Outcome("second-step-required");
        }

        if (request.CurrentPassword is null || !passwords.Verify(request.CurrentPassword, user.PasswordHash))
        {
            return Outcome("wrong-current");
        }

        if (string.Equals(request.CurrentPassword, request.NewPassword, StringComparison.Ordinal))
        {
            return Outcome("same-as-current");
        }

        // Authentication only lets a cookie through that names its session.
        var currentSessionId = principal.FindSessionId()
            ?? throw new InvalidOperationException("Authenticated principal has no session id.");
        user.PasswordHash = passwords.Hash(request.NewPassword);
        // The new version already invalidates every cookie issued before; the
        // sessions are revoked as well so that they stop showing as signed in.
        user.SessionVersion++;
        await db.SaveChangesAsync(cancellationToken);

        var now = DateTime.UtcNow;
        await db.UserSessions
            .Where(x => x.UserId == user.Id && x.Id != currentSessionId && x.RevokedAt == null)
            .ExecuteUpdateAsync(setters => setters.SetProperty(x => x.RevokedAt, now), cancellationToken);
        await db.TrustedDevices
            .Where(x => x.UserId == user.Id && x.RevokedAt == null)
            .ExecuteUpdateAsync(setters => setters.SetProperty(x => x.RevokedAt, now), cancellationToken);
        await db.DesktopBrowserLogins
            .Where(x => x.UserId == user.Id && x.ApprovedAt != null && x.RedeemedAt == null)
            .ExecuteUpdateAsync(setters => setters.SetProperty(x => x.RedeemedAt, now), cancellationToken);
        await db.UserSessions
            .Where(x => x.Id == currentSessionId)
            .ExecuteUpdateAsync(
                setters => setters.SetProperty(x => x.SecurityVersion, user.SessionVersion),
                cancellationToken);
        SecurityEvents.Record(
            db, user.Id, SecurityEventKinds.PasswordChanged, context, "password changed",
            await SecurityEvents.VerifiedEmailAsync(db, user.Id, cancellationToken));
        await db.SaveChangesAsync(cancellationToken);
        // This request's own cookie carries the old version.
        var shortLived = await db.UserSessions.AsNoTracking()
            .Where(x => x.Id == currentSessionId)
            .Select(x => x.ShortLived)
            .SingleAsync(cancellationToken);
        await SessionAuthentication.SignInAsync(context, user, currentSessionId, shortLived);
        return Outcome("changed");
    }

    private static void Apply(UpdatePreferencesRequest request, UserPreferenceSettings preferences)
    {
        preferences.DesktopNotifications = request.DesktopNotifications ?? preferences.DesktopNotifications;
        preferences.MentionPopups = request.MentionPopups ?? preferences.MentionPopups;
        preferences.CallRingtone = request.CallRingtone ?? preferences.CallRingtone;
        preferences.EmailNotifications = request.EmailNotifications ?? preferences.EmailNotifications;
        preferences.PushNotifications = request.PushNotifications ?? preferences.PushNotifications;
        preferences.MentionsOnly = request.MentionsOnly ?? preferences.MentionsOnly;
        preferences.MessageSound = request.MessageSound ?? preferences.MessageSound;
        preferences.JoinLeaveSound = request.JoinLeaveSound ?? preferences.JoinLeaveSound;
        preferences.AllowDirectMessages = request.AllowDirectMessages ?? preferences.AllowDirectMessages;
        preferences.AllowFriendRequests = request.AllowFriendRequests ?? preferences.AllowFriendRequests;
        preferences.ShowPresence = request.ShowPresence ?? preferences.ShowPresence;
        preferences.DeveloperMode = request.DeveloperMode ?? preferences.DeveloperMode;
        preferences.ReducedMotion = request.ReducedMotion ?? preferences.ReducedMotion;
        preferences.VadSensitivity = request.VadSensitivity ?? preferences.VadSensitivity;
        if (request.MutedChannelIds is not null)
        {
            preferences.MutedChannelIdsJson = JsonSerializer.Serialize(request.MutedChannelIds.Distinct());
        }
    }

    private static Task<bool> CanPlaySoundAsync(
        AppDbContext db,
        Guid userId,
        Guid soundId,
        CancellationToken cancellationToken) =>
        db.SoundboardSounds.AsNoTracking().AnyAsync(
            sound => sound.Id == soundId &&
                db.ServerMembers.Any(member => member.ServerId == sound.ServerId && member.UserId == userId),
            cancellationToken);

    private static async Task BroadcastPresenceAsync(
        IHubContext<AppHub> hub,
        PresenceTracker presence,
        AppDbContext db,
        Guid userId,
        CancellationToken cancellationToken)
    {
        var serverGroups = (await MemberServerIdsAsync(db, userId, cancellationToken))
            .Select(AppHub.ServerGroup)
            .ToArray();
        await hub.Clients.Groups(serverGroups).SendAsync(
            "PresenceChanged",
            new { userId = userId.ToString(), presence = presence.PublicPresenceOf(userId) },
            cancellationToken);
        await hub.Clients.Group(AppHub.UserGroup(userId)).SendAsync(
            "PresenceChanged",
            new { userId = userId.ToString(), presence = presence.PresenceOf(userId) },
            cancellationToken);
    }

    private static Task<Guid[]> MemberServerIdsAsync(AppDbContext db, Guid userId, CancellationToken cancellationToken) =>
        db.ServerMembers.AsNoTracking()
            .Where(x => x.UserId == userId)
            .Select(x => x.ServerId)
            .ToArrayAsync(cancellationToken);

    private static Dictionary<string, string[]> ValidateProfile(UpdateAccountRequest request, Messages messages)
    {
        var errors = new Dictionary<string, string[]>();
        if (request.DisplayName is not null && request.DisplayName.Trim().Length is < 1 or > DisplayNameMaxLength)
        {
            errors["displayName"] = [messages.Get(MessageKey.AccountDisplayNameLength, ("max", DisplayNameMaxLength))];
        }

        if (request.Bio is not null && request.Bio.Trim().Length > BioMaxLength)
        {
            errors["bio"] = [messages.Get(MessageKey.BioTooLong, ("max", BioMaxLength))];
        }

        if (request.CustomStatus is not null && request.CustomStatus.Trim().Length > CustomStatusMaxLength)
        {
            errors["customStatus"] = [messages.Get(MessageKey.CustomStatusTooLong, ("max", CustomStatusMaxLength))];
        }

        if (request.Pronouns is not null && request.Pronouns.Trim().Length > PronounsMaxLength)
        {
            errors["pronouns"] = [messages.Get(MessageKey.PronounsTooLong, ("max", PronounsMaxLength))];
        }

        return errors;
    }

    private static string? BlankToNull(string value)
    {
        var trimmed = value.Trim();
        return trimmed.Length == 0 ? null : trimmed;
    }

    private static IResult Outcome(string result) => Results.Ok(new { result });

    private static IResult Invalid(string field, string message) =>
        Results.ValidationProblem(new Dictionary<string, string[]> { [field] = [message] });
}
