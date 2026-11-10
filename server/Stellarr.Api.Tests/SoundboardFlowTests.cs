using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.SignalR.Client;

namespace Stellarr.Api.Tests;

public sealed class SoundboardFlowTests : IClassFixture<StellarrWebApplicationFactory>
{
    private readonly StellarrWebApplicationFactory _factory;

    public SoundboardFlowTests(StellarrWebApplicationFactory factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task OwnerCanCreateTrimUpdateAndDeleteServerSound()
    {
        using var owner = Client();
        await LoginAsync(owner, "maja", "Aurora!2026");
        var attachmentId = await UploadWaveAsync(owner, 8.25);

        var create = await owner.PostAsJsonAsync("/api/admin/soundboard/sounds", new
        {
            attachmentId,
            name = "Start rakiety",
            glyph = "🚀",
            trimStartSeconds = 1.25,
            trimEndSeconds = 5.5,
        });
        Assert.Equal(HttpStatusCode.Created, create.StatusCode);
        var created = await JsonAsync(create);
        var soundId = created.GetProperty("id").GetString();
        Assert.Equal(4.25, created.GetProperty("trimEndSeconds").GetDouble() -
            created.GetProperty("trimStartSeconds").GetDouble(), 3);

        var snapshotResponse = await owner.GetAsync("/api/soundboard");
        snapshotResponse.EnsureSuccessStatusCode();
        var snapshot = await JsonAsync(snapshotResponse);
        Assert.True(snapshot.GetProperty("canManage").GetBoolean());
        Assert.Contains(
            snapshot.GetProperty("sounds").EnumerateArray(),
            sound => sound.GetProperty("id").GetString() == soundId &&
                sound.GetProperty("url").GetString() == $"/assets/{attachmentId}");

        var update = await owner.PatchAsJsonAsync(
            $"/api/admin/soundboard/sounds/{soundId}",
            new { name = "Rakieta", trimStartSeconds = 2.0, trimEndSeconds = 4.0 });
        update.EnsureSuccessStatusCode();
        var updated = await JsonAsync(update);
        Assert.Equal("Rakieta", updated.GetProperty("name").GetString());
        Assert.Equal(2, updated.GetProperty("trimStartSeconds").GetDouble());
        Assert.Equal(4, updated.GetProperty("trimEndSeconds").GetDouble());

        var settings = await owner.PatchAsJsonAsync(
            "/api/admin/soundboard/settings",
            new { everyoneCanPlay = false, rateLimited = true });
        settings.EnsureSuccessStatusCode();
        var settingsJson = await JsonAsync(settings);
        Assert.False(settingsJson.GetProperty("everyoneCanPlay").GetBoolean());

        using var member = Client();
        await LoginAsync(member, "ilya", "Meteor!2026");
        var forbidden = await member.PostAsJsonAsync("/api/admin/soundboard/sounds", new
        {
            attachmentId,
            name = "Nie mój",
            glyph = "🔊",
            trimStartSeconds = 0,
            trimEndSeconds = 1,
        });
        Assert.Equal(HttpStatusCode.Forbidden, forbidden.StatusCode);

        var deleted = await owner.DeleteAsync($"/api/admin/soundboard/sounds/{soundId}");
        Assert.Equal(HttpStatusCode.NoContent, deleted.StatusCode);
    }

    [Fact]
    public async Task HubSchedulesSoundForVoiceGroupAndEnforcesCooldown()
    {
        using var client = Client();
        var login = await client.PostAsJsonAsync(
            "/api/auth/login",
            new { username = "maja", password = "Aurora!2026" });
        login.EnsureSuccessStatusCode();
        var cookie = string.Join(
            "; ",
            login.Headers.GetValues("Set-Cookie").Select(x => x.Split(';', 2)[0]));
        var attachmentId = await UploadWaveAsync(client, 3);
        var create = await client.PostAsJsonAsync("/api/admin/soundboard/sounds", new
        {
            attachmentId,
            name = "Ping",
            glyph = "🔔",
            trimStartSeconds = 0.5,
            trimEndSeconds = 2.5,
        });
        create.EnsureSuccessStatusCode();
        var soundId = (await JsonAsync(create)).GetProperty("id").GetString();

        await using var connection = new HubConnectionBuilder()
            .WithUrl("https://localhost/hubs/app", options =>
            {
                options.Headers["Cookie"] = cookie;
                options.Transports = HttpTransportType.LongPolling;
                options.HttpMessageHandlerFactory = _ => _factory.Server.CreateHandler();
            })
            .Build();
        var played = new TaskCompletionSource<JsonElement>(
            TaskCreationOptions.RunContinuationsAsynchronously);
        connection.On<JsonElement>("SoundboardPlayed", payload => played.TrySetResult(payload));

        await connection.StartAsync();
        var clock = await connection.InvokeAsync<long>("GetRtcClock");
        Assert.InRange(clock, DateTimeOffset.UtcNow.AddSeconds(-2).ToUnixTimeMilliseconds(),
            DateTimeOffset.UtcNow.AddSeconds(2).ToUnixTimeMilliseconds());

        const string channelId = "20000000-0000-0000-0000-000000000002";
        await connection.InvokeAsync("JoinVoice", channelId);
        await connection.InvokeAsync("PlaySoundboard", channelId, soundId);
        var playback = await played.Task.WaitAsync(TimeSpan.FromSeconds(2));
        Assert.Equal(channelId, playback.GetProperty("channelId").GetString());
        Assert.Equal(soundId, playback.GetProperty("sound").GetProperty("id").GetString());
        Assert.True(playback.GetProperty("startsAtUnixMs").GetInt64() > clock);

        await Assert.ThrowsAnyAsync<Exception>(
            () => connection.InvokeAsync("PlaySoundboard", channelId, soundId));
        await connection.StopAsync();
    }

    private HttpClient Client(bool handleCookies = true) =>
        _factory.CreateClient(new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            HandleCookies = handleCookies,
        });

    private static async Task LoginAsync(HttpClient client, string username, string password)
    {
        var response = await client.PostAsJsonAsync(
            "/api/auth/login",
            new { username, password });
        response.EnsureSuccessStatusCode();
    }

    private static async Task<string> UploadWaveAsync(HttpClient client, double duration)
    {
        // The storage boundary verifies the RIFF/WAVE family; media duration is
        // measured by the browser and sent alongside these exact bytes.
        var wave = new byte[]
        {
            (byte)'R', (byte)'I', (byte)'F', (byte)'F', 4, 0, 0, 0,
            (byte)'W', (byte)'A', (byte)'V', (byte)'E', 0, 0, 0, 0,
        };
        using var form = new MultipartFormDataContent();
        using var audio = new ByteArrayContent(wave);
        audio.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("audio/wav");
        form.Add(audio, "file", "sound.wav");
        form.Add(new StringContent(duration.ToString(System.Globalization.CultureInfo.InvariantCulture)),
            "durationSeconds");
        var response = await client.PostAsync("/api/uploads", form);
        response.EnsureSuccessStatusCode();
        return (await JsonAsync(response)).GetProperty("id").GetString()!;
    }

    private static async Task<JsonElement> JsonAsync(HttpResponseMessage response)
    {
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return document.RootElement.Clone();
    }
}
