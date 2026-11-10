using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Stellarr.Api.Data;

namespace Stellarr.Api.Tests;

public sealed class ModerationFlowTests
{
    private const string SalonChannelId = "20000000-0000-0000-0000-000000000002";
    private const string NightShiftChannelId = "20000000-0000-0000-0000-000000000005";
    private const string MajaId = "30000000-0000-0000-0000-000000000001";
    private const string JoId = "30000000-0000-0000-0000-000000000005";

    [Fact]
    public async Task BanPersistsItsAuditDataAndUnbanDoesNotSilentlyRejoinMember()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var owner = await AuthenticatedClientAsync(factory, "maja", "Aurora!2026");
        using var target = await AuthenticatedClientAsync(factory, "jo", "Corona!2026");

        var response = await owner.PostAsJsonAsync(
            $"/api/admin/members/{JoId}/ban",
            new { reason = "  uporczywy spam  " });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await target.GetAsync("/api/bootstrap")).StatusCode);

        var list = await owner.GetAsync("/api/admin/bans");
        list.EnsureSuccessStatusCode();
        using (var document = JsonDocument.Parse(await list.Content.ReadAsStringAsync()))
        {
            var ban = Assert.Single(document.RootElement.EnumerateArray());
            Assert.Equal(JoId, ban.GetProperty("userId").GetString());
            Assert.Equal("Jo", ban.GetProperty("displayName").GetString());
            Assert.Equal("Maja", ban.GetProperty("bannedByName").GetString());
            Assert.Equal("uporczywy spam", ban.GetProperty("reason").GetString());
        }

        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            Assert.False(await db.ServerMembers.AnyAsync(x => x.UserId == Guid.Parse(JoId)));
            Assert.True(await db.ServerBans.AnyAsync(x => x.UserId == Guid.Parse(JoId)));

            // Startup only upgrades the schema; it must never recreate a
            // membership removed by moderation.
            await DatabaseSchema.UpgradeAsync(db, CancellationToken.None);
            Assert.False(await db.ServerMembers.AnyAsync(x => x.UserId == Guid.Parse(JoId)));
        }

        Assert.Equal(
            HttpStatusCode.NoContent,
            (await owner.DeleteAsync($"/api/admin/bans/{JoId}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await target.GetAsync("/api/bootstrap")).StatusCode);
        await using var verification = factory.Services.CreateAsyncScope();
        Assert.False(await verification.ServiceProvider.GetRequiredService<AppDbContext>()
            .ServerBans.AnyAsync(x => x.UserId == Guid.Parse(JoId)));
    }

    [Fact]
    public async Task KickAndBanEnforcePermissionsSelfProtectionAndRoleHierarchy()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var owner = await AuthenticatedClientAsync(factory, "maja", "Aurora!2026");
        using var moderator = await AuthenticatedClientAsync(factory, "ada", "Quasar!2026");
        using var member = await AuthenticatedClientAsync(factory, "ilya", "Meteor!2026");
        using var target = await AuthenticatedClientAsync(factory, "jo", "Corona!2026");

        Assert.Equal(
            HttpStatusCode.Forbidden,
            (await member.DeleteAsync($"/api/admin/members/{JoId}")).StatusCode);
        Assert.Equal(
            HttpStatusCode.Forbidden,
            (await moderator.DeleteAsync($"/api/admin/members/{MajaId}")).StatusCode);
        Assert.Equal(
            HttpStatusCode.Forbidden,
            (await owner.DeleteAsync($"/api/admin/members/{MajaId}")).StatusCode);
        Assert.Equal(
            HttpStatusCode.Forbidden,
            (await member.PatchAsJsonAsync(
                $"/api/admin/channels/{SalonChannelId}/members/{JoId}",
                new { targetChannelId = NightShiftChannelId })).StatusCode);
        Assert.Equal(
            HttpStatusCode.Forbidden,
            (await moderator.PatchAsJsonAsync(
                $"/api/admin/channels/{SalonChannelId}/members/{MajaId}",
                new { targetChannelId = NightShiftChannelId })).StatusCode);

        var kicked = await moderator.DeleteAsync($"/api/admin/members/{JoId}");
        Assert.Equal(HttpStatusCode.NoContent, kicked.StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await target.GetAsync("/api/bootstrap")).StatusCode);
    }

    [Fact]
    public async Task BanImmediatelyRevokesRealtimeServerAndVoiceAccess()
    {
        using var factory = new StellarrWebApplicationFactory();
        await using var observer = await ConnectionAsync(factory, "maja", "Aurora!2026");
        await using var target = await ConnectionAsync(factory, "jo", "Corona!2026");
        var revoked = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
        var removed = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
        var voiceDrained = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
        using var revokedSubscription = target.On<JsonElement>(
            "ServerAccessRevoked",
            payload => revoked.TrySetResult(payload));
        using var removedSubscription = observer.On<JsonElement>(
            "ServerMemberRemoved",
            payload => removed.TrySetResult(payload));
        using var voiceSubscription = observer.On<JsonElement>(
            "VoiceParticipantChanged",
            payload =>
            {
                if (payload.GetProperty("channelId").GetString() == SalonChannelId &&
                    payload.GetProperty("participants").GetArrayLength() == 0)
                {
                    voiceDrained.TrySetResult(payload);
                }
            });

        await observer.StartAsync();
        await target.StartAsync();
        await target.InvokeAsync("JoinVoice", SalonChannelId);

        using var owner = await AuthenticatedClientAsync(factory, "maja", "Aurora!2026");
        var ban = await owner.PostAsJsonAsync(
            $"/api/admin/members/{JoId}/ban",
            new { reason = (string?)null });
        Assert.Equal(HttpStatusCode.Created, ban.StatusCode);

        var revokedEvent = await revoked.Task.WaitAsync(TimeSpan.FromSeconds(2));
        Assert.Equal("banned", revokedEvent.GetProperty("kind").GetString());
        Assert.Equal(JoId, (await removed.Task.WaitAsync(TimeSpan.FromSeconds(2)))
            .GetProperty("userId").GetString());
        await voiceDrained.Task.WaitAsync(TimeSpan.FromSeconds(2));

        await Assert.ThrowsAnyAsync<Exception>(
            () => target.InvokeAsync("JoinVoice", SalonChannelId));
        await Assert.ThrowsAnyAsync<Exception>(() => target.InvokeAsync("SendVoiceSignal", new
        {
            protocolVersion = 1,
            channelId = SalonChannelId,
            toUserId = (string?)null,
            kind = "state",
            payload = "{\"muted\":false}",
        }));
    }

    [Fact]
    public async Task VoiceKickDisconnectsOnlyTheSelectedChannelAndAllowsRejoin()
    {
        using var factory = new StellarrWebApplicationFactory();
        await using var observer = await ConnectionAsync(factory, "maja", "Aurora!2026");
        await using var target = await ConnectionAsync(factory, "jo", "Corona!2026");
        var kicked = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
        var drained = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
        using var kickedSubscription = target.On<JsonElement>(
            "VoiceChannelKicked",
            payload => kicked.TrySetResult(payload));
        using var voiceSubscription = observer.On<JsonElement>(
            "VoiceParticipantChanged",
            payload =>
            {
                if (payload.GetProperty("channelId").GetString() == SalonChannelId &&
                    payload.GetProperty("participants").GetArrayLength() == 0)
                {
                    drained.TrySetResult(payload);
                }
            });

        await observer.StartAsync();
        await target.StartAsync();
        await target.InvokeAsync("JoinVoice", SalonChannelId);

        using var owner = await AuthenticatedClientAsync(factory, "maja", "Aurora!2026");
        var response = await owner.DeleteAsync(
            $"/api/admin/channels/{SalonChannelId}/members/{JoId}");
        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Equal(
            SalonChannelId,
            (await kicked.Task.WaitAsync(TimeSpan.FromSeconds(2)))
                .GetProperty("channelId").GetString());
        await drained.Task.WaitAsync(TimeSpan.FromSeconds(2));

        // This is channel moderation, not a server kick or a ban.
        using var targetHttp = await AuthenticatedClientAsync(factory, "jo", "Corona!2026");
        Assert.Equal(HttpStatusCode.OK, (await targetHttp.GetAsync("/api/bootstrap")).StatusCode);
        await target.InvokeAsync("JoinVoice", SalonChannelId);
    }

    [Fact]
    public async Task ModeratorCanMoveAnotherMembersLiveVoiceSessionBetweenChannels()
    {
        using var factory = new StellarrWebApplicationFactory();
        await using var observer = await ConnectionAsync(factory, "maja", "Aurora!2026");
        await using var target = await ConnectionAsync(factory, "jo", "Corona!2026");
        var moved = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
        var sourceDrained = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
        var targetFilled = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
        using var movedSubscription = target.On<JsonElement>(
            "VoiceChannelMoved",
            payload => moved.TrySetResult(payload));
        using var occupancySubscription = observer.On<JsonElement>(
            "VoiceParticipantChanged",
            payload =>
            {
                var channelId = payload.GetProperty("channelId").GetString();
                var participants = payload.GetProperty("participants");
                if (channelId == SalonChannelId && participants.GetArrayLength() == 0)
                {
                    sourceDrained.TrySetResult(payload);
                }
                if (channelId == NightShiftChannelId && participants.GetArrayLength() == 1)
                {
                    targetFilled.TrySetResult(payload);
                }
            });

        await observer.StartAsync();
        await target.StartAsync();
        await target.InvokeAsync("JoinVoice", SalonChannelId);

        using var owner = await AuthenticatedClientAsync(factory, "maja", "Aurora!2026");
        var response = await owner.PatchAsJsonAsync(
            $"/api/admin/channels/{SalonChannelId}/members/{JoId}",
            new { targetChannelId = NightShiftChannelId });
        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);

        var moveEvent = await moved.Task.WaitAsync(TimeSpan.FromSeconds(2));
        Assert.Equal(SalonChannelId, moveEvent.GetProperty("fromChannelId").GetString());
        Assert.Equal(NightShiftChannelId, moveEvent.GetProperty("toChannelId").GetString());
        await sourceDrained.Task.WaitAsync(TimeSpan.FromSeconds(2));
        await targetFilled.Task.WaitAsync(TimeSpan.FromSeconds(2));

        // The existing SignalR connection now owns the target seat and may
        // signal there without a disconnect/reconnect round trip.
        await target.InvokeAsync("SendVoiceSignal", new
        {
            protocolVersion = 1,
            channelId = NightShiftChannelId,
            toUserId = (string?)null,
            kind = "state",
            payload = "{\"muted\":true}",
        });
    }

    private static async Task<HttpClient> AuthenticatedClientAsync(
        StellarrWebApplicationFactory factory,
        string username,
        string password)
    {
        var client = factory.CreateClient(
            new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions
            {
                AllowAutoRedirect = false,
                HandleCookies = true,
            });
        (await client.PostAsJsonAsync("/api/auth/login", new { username, password }))
            .EnsureSuccessStatusCode();
        return client;
    }

    private static async Task<HubConnection> ConnectionAsync(
        StellarrWebApplicationFactory factory,
        string username,
        string password)
    {
        using var client = factory.CreateClient(
            new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions
            {
                AllowAutoRedirect = false,
                HandleCookies = false,
            });
        var login = await client.PostAsJsonAsync(
            "/api/auth/login",
            new { username, password });
        login.EnsureSuccessStatusCode();
        var cookie = string.Join(
            "; ",
            login.Headers.GetValues("Set-Cookie").Select(x => x.Split(';', 2)[0]));
        return new HubConnectionBuilder()
            .WithUrl("https://localhost/hubs/app", options =>
            {
                options.Headers["Cookie"] = cookie;
                options.Transports = HttpTransportType.LongPolling;
                options.HttpMessageHandlerFactory = _ => factory.Server.CreateHandler();
            })
            .Build();
    }
}
