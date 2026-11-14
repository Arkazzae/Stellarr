using System.Text.Json;
using Stellarr.Api.Domain;

namespace Stellarr.Api.Contracts;

public sealed record UpdateAccountRequest(
    string? DisplayName,
    string? Email,
    string? CustomStatus,
    string? Bio,
    string? Pronouns);

public sealed record UpdatePreferencesRequest(
    bool? DesktopNotifications,
    bool? EmailNotifications,
    bool? PushNotifications,
    bool? MentionsOnly,
    bool? MessageSound,
    bool? JoinLeaveSound,
    bool? AllowDirectMessages,
    bool? AllowFriendRequests,
    bool? ShowPresence,
    bool? DeveloperMode,
    bool? ReducedMotion,
    IReadOnlyList<Guid>? MutedChannelIds,
    int? VadSensitivity,
    // A soundboard sound id to announce this account's arrivals with. Empty
    // clears the choice; absent leaves it alone, like every field around it.
    string? JoinSoundId = null,
    bool? MentionPopups = null,
    bool? CallRingtone = null);

/// <summary>
/// The client's own settings, one object per section, or null for a section no
/// device has saved yet. The fields belong to the client and are passed through.
/// </summary>
public sealed record ClientSettingsDto(
    JsonElement? Appearance,
    JsonElement? Language,
    JsonElement? Keybinds,
    JsonElement? Voice);

public sealed record ChangePasswordRequest(string CurrentPassword, string NewPassword);

public sealed record ForgotPasswordRequest(string Email);

public sealed record ResetPasswordRequest(string Token, string NewPassword);

public sealed record UserPreferencesDto(
    bool DesktopNotifications,
    bool EmailNotifications,
    bool PushNotifications,
    bool MentionsOnly,
    bool MessageSound,
    bool JoinLeaveSound,
    bool AllowDirectMessages,
    bool AllowFriendRequests,
    bool ShowPresence,
    bool DeveloperMode,
    bool ReducedMotion,
    IReadOnlyList<string> MutedChannelIds,
    int VadSensitivity,
    // Null when arrivals use the shared chime.
    string? JoinSoundId = null,
    bool MentionPopups = true,
    bool CallRingtone = true);

public sealed record AccountDto(
    string Id,
    string Username,
    string DisplayName,
    string? Email,
    DateTime CreatedAt,
    string? AvatarUrl,
    string? BannerUrl,
    string CustomStatus,
    string Bio,
    string Pronouns,
    UserPreferencesDto Preferences);

/// <summary>
/// One server's sounds, as offered to somebody choosing their own arrival.
/// The list is grouped by server because that is how the person knows a sound:
/// not as one flat catalogue, but as "the one from the server with the frogs".
/// </summary>
public sealed record JoinSoundServerDto(
    string ServerId,
    string ServerName,
    string? IconUrl,
    IReadOnlyList<SoundboardSoundDto> Sounds);

public sealed record JoinSoundLibraryDto(
    // The audible window, so the picker can preview exactly what is heard.
    double MaxSeconds,
    string? SelectedId,
    IReadOnlyList<JoinSoundServerDto> Servers);

public static class AccountContractMappings
{
    /// <param name="preferences">Null for an account that never saved any: it has the defaults.</param>
    public static UserPreferencesDto ToDto(this UserPreferenceSettings? preferences) => new(
        preferences?.DesktopNotifications ?? true,
        preferences?.EmailNotifications ?? false,
        preferences?.PushNotifications ?? false,
        preferences?.MentionsOnly ?? true,
        preferences?.MessageSound ?? true,
        preferences?.JoinLeaveSound ?? true,
        preferences?.AllowDirectMessages ?? true,
        preferences?.AllowFriendRequests ?? true,
        preferences?.ShowPresence ?? true,
        preferences?.DeveloperMode ?? false,
        preferences?.ReducedMotion ?? false,
        ReadMutedChannelIds(preferences),
        preferences?.VadSensitivity ?? 60,
        preferences?.JoinSoundId?.ToString(),
        preferences?.MentionPopups ?? true,
        preferences?.CallRingtone ?? true);

    /// <remarks>The account's preferences must be loaded.</remarks>
    public static AccountDto ToAccountDto(this User user) => new(
        user.Id.ToString(),
        user.Username,
        user.DisplayName,
        user.Email,
        user.CreatedAt,
        user.AvatarUrl,
        user.BannerUrl,
        user.CustomStatus ?? "",
        user.Bio ?? "",
        user.Pronouns ?? "",
        user.Preferences.ToDto());

    private static string[] ReadMutedChannelIds(UserPreferenceSettings? preferences)
    {
        if (preferences is null)
        {
            return [];
        }

        try
        {
            return JsonSerializer.Deserialize<string[]>(preferences.MutedChannelIdsJson) ?? [];
        }
        catch (JsonException)
        {
            // A damaged preference must not make the whole private account unreadable.
            return [];
        }
    }
}
