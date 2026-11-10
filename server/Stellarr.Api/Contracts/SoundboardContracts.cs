using Stellarr.Api.Domain;

namespace Stellarr.Api.Contracts;

public sealed record SoundboardSoundDto(
    string Id,
    string Name,
    string Glyph,
    string Url,
    double DurationSeconds,
    double TrimStartSeconds,
    double TrimEndSeconds);

public sealed record SoundboardSettingsDto(bool EveryoneCanPlay, bool RateLimited);

public sealed record SoundboardSnapshotDto(
    IReadOnlyList<SoundboardSoundDto> Sounds,
    SoundboardSettingsDto Settings,
    bool CanManage);

/// <param name="StartsAtUnixMs">
/// The moment every client starts the clip against the RTC clock, so that the
/// room hears it together whatever each connection's latency.
/// </param>
public sealed record SoundboardPlayedDto(
    string PlaybackId,
    string ChannelId,
    string TriggeredByUserId,
    long StartsAtUnixMs,
    SoundboardSoundDto Sound);

public sealed record CreateSoundboardSoundRequest(
    Guid AttachmentId,
    string? Name,
    string? Glyph,
    double TrimStartSeconds,
    double TrimEndSeconds);

public sealed record UpdateSoundboardSoundRequest(
    string? Name,
    string? Glyph,
    double? TrimStartSeconds,
    double? TrimEndSeconds);

public sealed record UpdateSoundboardSettingsRequest(bool? EveryoneCanPlay, bool? RateLimited);

public static class SoundboardContractMappings
{
    /// <remarks>The sound's attachment must be loaded.</remarks>
    public static SoundboardSoundDto ToDto(this SoundboardSound sound) => new(
        sound.Id.ToString(),
        sound.Name,
        sound.Glyph,
        $"/assets/{sound.AttachmentId}",
        sound.Attachment.DurationSeconds ?? sound.TrimEndSeconds,
        sound.TrimStartSeconds,
        sound.TrimEndSeconds);

    /// <summary>
    /// The same clip, cut to the window an arrival is allowed to occupy. The
    /// picker and the room are handed the identical shortened trim, so what
    /// somebody auditions in settings is exactly what a channel hears.
    /// </summary>
    public static SoundboardSoundDto ToJoinSoundDto(this SoundboardSound sound) =>
        sound.ToDto() with
        {
            TrimEndSeconds = JoinSound.WindowEnd(sound.TrimStartSeconds, sound.TrimEndSeconds),
        };
}
