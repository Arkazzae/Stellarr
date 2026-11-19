using Stellarr.Api.Data;
using Stellarr.Api.Domain;

namespace Stellarr.Api.Auth;

/// <summary>
/// Who may play a server's soundboard. The hub decides each play by it and
/// the catalogue tells every member the same answer in advance, so both read
/// it from here.
/// </summary>
public static class SoundboardAccess
{
    /// <summary>Who may play when the server keeps its soundboard to staff.</summary>
    public const ServerPrivileges Staff =
        ServerPrivileges.ManageServer | ServerPrivileges.ManageMessages | ServerPrivileges.ModerateMembers;

    /// <summary>
    /// Whether the member may play the server's sounds under its rule. A seat
    /// in the room and the cooldown are checked by the hub, for each play.
    /// </summary>
    public static async Task<bool> CanPlayAsync(
        AppDbContext db,
        Guid userId,
        Guid serverId,
        bool everyoneCanPlay,
        CancellationToken cancellationToken = default) =>
        everyoneCanPlay ||
        (await ServerAccess.GetAsync(db, userId, serverId, cancellationToken) & Staff) != ServerPrivileges.None;
}
