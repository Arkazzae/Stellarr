namespace Stellarr.Api.Domain;

/// <summary>What the server accepts as one section of the client's own settings.</summary>
public static class ClientSettings
{
    /// <summary>
    /// Far above what any section needs today (the voice section is under a
    /// kilobyte), and small enough that a row cannot be used as storage.
    /// </summary>
    public const int MaxLength = 8192;

    /// <summary>The sections a client may save, by the name in the route.</summary>
    public static readonly IReadOnlyList<string> Sections = ["appearance", "language", "keybinds", "voice"];

    public static string? Read(UserPreferenceSettings? preferences, string section) => preferences is null
        ? null
        : section switch
        {
            "appearance" => preferences.AppearanceSettingsJson,
            "language" => preferences.LanguageSettingsJson,
            "keybinds" => preferences.KeybindSettingsJson,
            "voice" => preferences.VoiceSettingsJson,
            _ => throw new ArgumentOutOfRangeException(nameof(section), section, null),
        };

    public static void Write(UserPreferenceSettings preferences, string section, string json)
    {
        switch (section)
        {
            case "appearance":
                preferences.AppearanceSettingsJson = json;
                break;
            case "language":
                preferences.LanguageSettingsJson = json;
                break;
            case "keybinds":
                preferences.KeybindSettingsJson = json;
                break;
            case "voice":
                preferences.VoiceSettingsJson = json;
                break;
            default:
                throw new ArgumentOutOfRangeException(nameof(section), section, null);
        }
    }
}
