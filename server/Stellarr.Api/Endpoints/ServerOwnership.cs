using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Auth;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;

namespace Stellarr.Api.Endpoints;

/// <summary>
/// Handing a server on and deleting it: what its owner does from the server
/// settings and the operator does from Cockpit, written once for both.
/// </summary>
internal static class ServerOwnership
{
    /// <summary>
    /// Moves the owner slot from <paramref name="owner"/> to <paramref name="successor"/>,
    /// who must both be tracked members of <paramref name="serverId"/>. The old
    /// owner becomes a plain member. Run it in a transaction: the slot is freed
    /// and saved before it is handed on, and that moment must not be seen. The
    /// successor's change is staged; the caller saves it with its audit line.
    /// </summary>
    internal static async Task HandOverAsync(
        AppDbContext db,
        Guid serverId,
        ServerMember owner,
        ServerMember successor,
        CancellationToken cancellationToken)
    {
        var memberRole = await ServerAccess.FindMemberRoleAsync(db, serverId, cancellationToken)
            ?? throw new InvalidOperationException("The server has no role for plain members.");

        // The owner slot is unique, so it is freed before it is handed on.
        var ownerRoleId = owner.RoleId;
        owner.RoleId = memberRole.Id;
        owner.OwnerSlot = null;
        await db.SaveChangesAsync(cancellationToken);

        successor.RoleId = ownerRoleId;
        successor.OwnerSlot = 1;
    }

    /// <summary>
    /// Deletes the server; its channels, messages, roles and memberships go with
    /// it by cascade, and the maintenance worker later removes the stored files
    /// nothing refers to any more.
    /// </summary>
    /// <returns>Whether there was such a server.</returns>
    internal static async Task<bool> DeleteAsync(
        AppDbContext db,
        Guid serverId,
        CancellationToken cancellationToken) =>
        await db.Servers.Where(x => x.Id == serverId).ExecuteDeleteAsync(cancellationToken) > 0;
}
