using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Stellarr.Api.Auth;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;

namespace Stellarr.Api.Tests;

/// <summary>Small, deterministic dataset owned exclusively by integration tests.</summary>
internal static class TestData
{
    internal static readonly Guid ServerId = Guid.Parse("10000000-0000-0000-0000-000000000001");
    internal static readonly Guid GeneralChannelId = Guid.Parse("20000000-0000-0000-0000-000000000001");
    internal static readonly Guid VoiceChannelId = Guid.Parse("20000000-0000-0000-0000-000000000002");
    internal static readonly Guid ProjectsChannelId = Guid.Parse("20000000-0000-0000-0000-000000000003");
    internal static readonly Guid MemesChannelId = Guid.Parse("20000000-0000-0000-0000-000000000004");
    internal static readonly Guid NightShiftChannelId = Guid.Parse("20000000-0000-0000-0000-000000000005");

    private static readonly Guid OwnerRoleId = Guid.Parse("60000000-0000-0000-0000-000000000001");
    private static readonly Guid ModeratorRoleId = Guid.Parse("60000000-0000-0000-0000-000000000002");
    private static readonly Guid MemberRoleId = Guid.Parse("60000000-0000-0000-0000-000000000003");

    private static readonly (Guid Id, string Username, string DisplayName, string Password)[] Users =
    [
        (Guid.Parse("30000000-0000-0000-0000-000000000001"), "maja", "Maja", "Aurora!2026"),
        (Guid.Parse("30000000-0000-0000-0000-000000000002"), "ada", "Ada", "Quasar!2026"),
        (Guid.Parse("30000000-0000-0000-0000-000000000003"), "ilya", "Ilya", "Meteor!2026"),
        (Guid.Parse("30000000-0000-0000-0000-000000000004"), "nils", "Nils", "Zenith!2026"),
        (Guid.Parse("30000000-0000-0000-0000-000000000005"), "jo", "Jo", "Corona!2026"),
    ];

    internal static async Task LoadAsync(
        AppDbContext db,
        PasswordService passwords,
        CancellationToken cancellationToken)
    {
        if (await db.Users.AnyAsync(cancellationToken)) return;

        var now = DateTime.UtcNow;
        db.Servers.Add(new StellarrServer
        {
            Id = ServerId,
            Name = "Orbit",
            Description = "Integration test server",
            CreatedAt = now,
        });
        db.ServerRoles.AddRange(
            new ServerRole
            {
                Id = OwnerRoleId,
                ServerId = ServerId,
                Name = "Właściciel",
                Color = "#d65775",
                Permissions = ServerPrivileges.All,
                Position = 0,
                IsSystem = true,
                IsOwner = true,
            },
            new ServerRole
            {
                Id = ModeratorRoleId,
                ServerId = ServerId,
                Name = "Moderacja",
                Color = "#62ad78",
                Permissions = ServerPrivileges.ManageMessages |
                    ServerPrivileges.ModerateMembers |
                    ServerPrivileges.ManageBans,
                Position = 1,
            },
            new ServerRole
            {
                Id = MemberRoleId,
                ServerId = ServerId,
                Name = "Członek",
                Color = "#777777",
                Permissions = ServerPrivileges.None,
                Position = 2,
                IsSystem = true,
            });
        db.Channels.AddRange(
            new Channel { Id = GeneralChannelId, ServerId = ServerId, Name = "ogólny", Kind = ChannelKind.Text, Position = 0 },
            new Channel { Id = ProjectsChannelId, ServerId = ServerId, Name = "projekty", Kind = ChannelKind.Text, Position = 1 },
            new Channel { Id = MemesChannelId, ServerId = ServerId, Name = "memy", Kind = ChannelKind.Text, Position = 2 },
            new Channel { Id = VoiceChannelId, ServerId = ServerId, Name = "Salon", Kind = ChannelKind.Voice, Position = 3 },
            new Channel { Id = NightShiftChannelId, ServerId = ServerId, Name = "Nocna zmiana", Kind = ChannelKind.Voice, Position = 4 });
        db.ServerAdminSettings.Add(new ServerAdminSettings { ServerId = ServerId });

        foreach (var (id, username, displayName, password) in Users)
        {
            db.Users.Add(new User
            {
                Id = id,
                Username = username,
                NormalizedUsername = username.ToUpperInvariant(),
                DisplayName = displayName,
                PasswordHash = passwords.Hash(password),
                AvatarColor = "#777777",
                CreatedAt = now,
            });
            db.ServerMembers.Add(new ServerMember
            {
                ServerId = ServerId,
                UserId = id,
                RoleId = id == Users[0].Id
                    ? OwnerRoleId
                    : id == Users[1].Id
                        ? ModeratorRoleId
                        : MemberRoleId,
                OwnerSlot = id == Users[0].Id ? 1 : null,
                JoinedAt = now,
            });
        }

        db.Messages.Add(new Message
        {
            Id = Guid.Parse("40000000-0000-0000-0000-000000000001"),
            ChannelId = GeneralChannelId,
            AuthorId = Users[1].Id,
            Content = "integration fixture",
            CreatedAt = now,
        });
        await db.SaveChangesAsync(cancellationToken);
    }
}

internal sealed class TestDataHostedService(IServiceProvider services) : IHostedService
{
    public async Task StartAsync(CancellationToken cancellationToken)
    {
        await using var scope = services.CreateAsyncScope();
        await TestData.LoadAsync(
            scope.ServiceProvider.GetRequiredService<AppDbContext>(),
            scope.ServiceProvider.GetRequiredService<PasswordService>(),
            cancellationToken);
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
}
