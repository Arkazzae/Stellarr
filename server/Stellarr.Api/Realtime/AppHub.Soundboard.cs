using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Auth;
using Stellarr.Api.Contracts;
using Stellarr.Api.Domain;

namespace Stellarr.Api.Realtime;

/// <summary>Clips played into a voice room, by the soundboard and as an arrival.</summary>
public sealed partial class AppHub
{
    /// <summary>
    /// How far ahead a clip is scheduled: long enough for every client to fetch,
    /// decode and cache the audio, short enough that the sound still belongs to
    /// the moment it announces.
    /// </summary>
    private const int PlaybackLeadMs = 750;

    private static readonly TimeSpan SoundboardCooldown = TimeSpan.FromSeconds(5);

    /// <summary>
    /// The cooldown scope of arrivals. A soundboard cooldown is keyed by the
    /// server whose sound was played; an arrival belongs to the person and to
    /// no server, so it takes a scope that no server id can equal.
    /// </summary>
    private static readonly Guid JoinSoundScope = Guid.Empty;

    /// <summary>Who may play when the server keeps its soundboard to staff.</summary>
    private const ServerPrivileges SoundboardStaff =
        ServerPrivileges.ManageServer | ServerPrivileges.ManageMessages | ServerPrivileges.ModerateMembers;

    /// <summary>
    /// Plays one of the server's clips for everyone seated in a voice channel.
    /// The start is scheduled a fixed lead ahead and shared by all of them, so
    /// that clients start against the RTC clock and not against packet arrival.
    /// </summary>
    public async Task PlaySoundboard(string channelId, string soundId)
    {
        var roomId = ParseGuid(channelId, nameof(channelId));
        var clipId = ParseGuid(soundId, nameof(soundId));
        var userId = Context.User!.RequireUserId();
        if (!presence.IsConnectionInVoice(Context.ConnectionId, roomId))
        {
            throw new HubException("Join the voice channel before playing a sound.");
        }

        var serverId = await db.Channels.AsNoTracking()
            .Where(x => x.Id == roomId &&
                x.Kind == ChannelKind.Voice &&
                db.ServerMembers.Any(member => member.ServerId == x.ServerId && member.UserId == userId))
            .Select(x => (Guid?)x.ServerId)
            .SingleOrDefaultAsync() ?? throw new HubException("Unknown voice channel.");
        var rules = await db.Servers.AsNoTracking()
            .Where(x => x.Id == serverId)
            .Select(x => new { x.SoundboardEveryoneCanPlay, x.SoundboardRateLimited })
            .SingleOrDefaultAsync();
        var sound = await db.SoundboardSounds.AsNoTracking()
            .Include(x => x.Attachment)
            .FirstOrDefaultAsync(x => x.Id == clipId && x.ServerId == serverId);
        if (rules is null || sound is null)
        {
            throw new HubException("Unknown soundboard sound.");
        }

        if (!rules.SoundboardEveryoneCanPlay &&
            (await ServerAccess.GetAsync(db, userId, serverId) & SoundboardStaff) == ServerPrivileges.None)
        {
            throw new HubException("Soundboard playback is restricted.");
        }

        if (rules.SoundboardRateLimited && !soundboardGate.TryAcquire(userId, serverId, SoundboardCooldown))
        {
            throw new HubException("Soundboard cooldown is active.");
        }

        await Clients.Clients(presence.VoiceConnectionIds(roomId))
            .SendAsync("SoundboardPlayed", ScheduledPlayback(roomId, userId, sound.ToDto()));
    }

    /// <summary>
    /// Plays the joiner's own clip to the room they just walked into. It rides
    /// the soundboard's envelope, so the joiner hears it too and the setting
    /// is something one can check rather than take on trust. The clip is cut
    /// to <see cref="JoinSound.MaxSeconds"/> here and not in the browser,
    /// because how long an arrival may last is a rule of the room and not a
    /// preference of whoever listens.
    /// </summary>
    private async Task AnnounceJoinSoundAsync(Guid roomId, Guid userId)
    {
        var chosenId = await db.UserPreferences.AsNoTracking()
            .Where(x => x.UserId == userId)
            .Select(x => x.JoinSoundId)
            .SingleOrDefaultAsync();
        if (chosenId is not { } soundId)
        {
            return;
        }

        // Leaving the server a clip came from takes the greeting with it:
        // nobody in the room could fetch the audio afterwards, so a silent
        // arrival is the honest outcome.
        var sound = await db.SoundboardSounds.AsNoTracking()
            .Include(x => x.Attachment)
            .FirstOrDefaultAsync(x => x.Id == soundId &&
                db.ServerMembers.Any(member => member.ServerId == x.ServerId && member.UserId == userId));
        if (sound is null || !soundboardGate.TryAcquire(userId, JoinSoundScope, JoinSound.Cooldown))
        {
            return;
        }

        await Clients.Clients(presence.VoiceConnectionIds(roomId))
            .SendAsync("JoinSoundPlayed", ScheduledPlayback(roomId, userId, sound.ToJoinSoundDto()));
    }

    private static SoundboardPlayedDto ScheduledPlayback(Guid roomId, Guid userId, SoundboardSoundDto sound) => new(
        Guid.NewGuid().ToString(),
        roomId.ToString(),
        userId.ToString(),
        DateTimeOffset.UtcNow.AddMilliseconds(PlaybackLeadMs).ToUnixTimeMilliseconds(),
        sound);
}
