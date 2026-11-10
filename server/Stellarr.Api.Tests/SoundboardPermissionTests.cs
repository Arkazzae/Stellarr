using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading.Channels;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.SignalR.Client;

namespace Stellarr.Api.Tests;

/// <summary>
/// Who may manage the soundboard and who may play it. The test data has an
/// owner (maja), a moderator without ManageServer (ada) and plain members.
/// </summary>
public sealed class SoundboardPermissionTests : IClassFixture<StellarrWebApplicationFactory>
{
    private const string VoiceChannelId = "20000000-0000-0000-0000-000000000002";

    private readonly StellarrWebApplicationFactory _factory;

    public SoundboardPermissionTests(StellarrWebApplicationFactory factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task OnlyStaffPlayWhenEveryoneCanPlayIsOff()
    {
        using var owner = await SignInAsync("maja", "Aurora!2026");
        var soundId = await CreateSoundAsync(owner);
        await ConfigureAsync(owner, everyoneCanPlay: false, rateLimited: false);

        using var memberAccount = await SignInAsync("ilya", "Meteor!2026");
        using var moderatorAccount = await SignInAsync("ada", "Quasar!2026");
        await using var member = await ConnectAsync(memberAccount);
        await using var moderator = await ConnectAsync(moderatorAccount);

        var refused = await Assert.ThrowsAsync<HubException>(
            () => member.Connection.InvokeAsync("PlaySoundboard", VoiceChannelId, soundId));
        Assert.Contains("restricted", refused.Message);

        await moderator.Connection.InvokeAsync("PlaySoundboard", VoiceChannelId, soundId);
        var played = await moderator.NextPlaybackAsync();
        Assert.Equal(soundId, played.GetProperty("sound").GetProperty("id").GetString());
        // The member is in the room, so they hear what the moderator played.
        Assert.Equal(soundId, (await member.NextPlaybackAsync()).GetProperty("sound").GetProperty("id").GetString());
    }

    [Fact]
    public async Task EveryonePlaysWhenTheServerAllowsItAndTheCooldownIsOff()
    {
        using var owner = await SignInAsync("maja", "Aurora!2026");
        var soundId = await CreateSoundAsync(owner);
        await ConfigureAsync(owner, everyoneCanPlay: true, rateLimited: false);

        using var memberAccount = await SignInAsync("jo", "Corona!2026");
        await using var member = await ConnectAsync(memberAccount);

        await member.Connection.InvokeAsync("PlaySoundboard", VoiceChannelId, soundId);
        await member.Connection.InvokeAsync("PlaySoundboard", VoiceChannelId, soundId);
        await member.NextPlaybackAsync();
        await member.NextPlaybackAsync();
    }

    [Fact]
    public async Task PlayingNeedsASeatInTheVoiceChannel()
    {
        using var owner = await SignInAsync("maja", "Aurora!2026");
        var soundId = await CreateSoundAsync(owner);

        using var account = await SignInAsync("nils", "Zenith!2026");
        await using var connection = BuildConnection(account);
        await connection.StartAsync();

        await Assert.ThrowsAsync<HubException>(
            () => connection.InvokeAsync("PlaySoundboard", VoiceChannelId, soundId));
    }

    [Fact]
    public async Task ManagingSoundsAndSettingsNeedsManageServer()
    {
        using var owner = await SignInAsync("maja", "Aurora!2026");
        var soundId = await CreateSoundAsync(owner);
        await ConfigureAsync(owner, everyoneCanPlay: true, rateLimited: true);

        foreach (var (username, password) in new[] { ("ada", "Quasar!2026"), ("ilya", "Meteor!2026") })
        {
            using var person = await SignInAsync(username, password);
            var ownAudio = await UploadWaveAsync(person.Client, 3);

            var create = await person.Client.PostAsJsonAsync("/api/admin/soundboard/sounds", new
            {
                attachmentId = ownAudio,
                name = "Moje",
                glyph = "🎵",
                trimStartSeconds = 0,
                trimEndSeconds = 1,
            });
            Assert.Equal(HttpStatusCode.Forbidden, create.StatusCode);
            Assert.Equal(
                HttpStatusCode.Forbidden,
                (await person.Client.PatchAsJsonAsync(
                    $"/api/admin/soundboard/sounds/{soundId}", new { name = "Przejęte" })).StatusCode);
            Assert.Equal(
                HttpStatusCode.Forbidden,
                (await person.Client.DeleteAsync($"/api/admin/soundboard/sounds/{soundId}")).StatusCode);
            Assert.Equal(
                HttpStatusCode.Forbidden,
                (await person.Client.PatchAsJsonAsync(
                    "/api/admin/soundboard/settings", new { everyoneCanPlay = false })).StatusCode);

            var snapshot = await JsonAsync(await person.Client.GetAsync("/api/soundboard"));
            Assert.False(snapshot.GetProperty("canManage").GetBoolean());
            Assert.True(snapshot.GetProperty("settings").GetProperty("everyoneCanPlay").GetBoolean());
            var sound = Assert.Single(
                snapshot.GetProperty("sounds").EnumerateArray(),
                x => x.GetProperty("id").GetString() == soundId);
            Assert.NotEqual("Przejęte", sound.GetProperty("name").GetString());
        }

        var ownerSnapshot = await JsonAsync(await owner.Client.GetAsync("/api/soundboard"));
        Assert.True(ownerSnapshot.GetProperty("canManage").GetBoolean());
    }

    [Fact]
    public async Task DeletingASoundReleasesTheJoinSoundThatNamedIt()
    {
        using var owner = await SignInAsync("maja", "Aurora!2026");
        var soundId = await CreateSoundAsync(owner);

        using var member = await SignInAsync("ilya", "Meteor!2026");
        (await member.Client.PatchAsJsonAsync("/api/me/preferences", new { joinSoundId = soundId }))
            .EnsureSuccessStatusCode();
        Assert.Equal(soundId, await JoinSoundIdAsync(member));

        Assert.Equal(
            HttpStatusCode.NoContent,
            (await owner.Client.DeleteAsync($"/api/admin/soundboard/sounds/{soundId}")).StatusCode);

        Assert.Equal(JsonValueKind.Null, (await PreferencesAsync(member)).GetProperty("joinSoundId").ValueKind);
        Assert.Equal(
            HttpStatusCode.NoContent,
            (await owner.Client.DeleteAsync($"/api/admin/soundboard/sounds/{soundId}")).StatusCode);
    }

    private async Task<Person> SignInAsync(string username, string password)
    {
        var client = _factory.CreateClient(new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            HandleCookies = true,
        });
        var response = await client.PostAsJsonAsync("/api/auth/login", new { username, password });
        response.EnsureSuccessStatusCode();
        var cookie = string.Join(
            "; ",
            response.Headers.GetValues("Set-Cookie").Select(x => x.Split(';', 2)[0]));
        return new Person(client, cookie);
    }

    private HubConnection BuildConnection(Person person) => new HubConnectionBuilder()
        .WithUrl("https://localhost/hubs/app", options =>
        {
            options.Headers["Cookie"] = person.Cookie;
            options.Transports = HttpTransportType.LongPolling;
            options.HttpMessageHandlerFactory = _ => _factory.Server.CreateHandler();
        })
        .Build();

    /// <summary>Connects and takes a seat in the voice channel.</summary>
    private async Task<HubSession> ConnectAsync(Person person)
    {
        var connection = BuildConnection(person);
        var session = new HubSession(connection);
        connection.On<JsonElement>("SoundboardPlayed", payload => session.Played.Writer.TryWrite(payload));
        await connection.StartAsync();
        await connection.InvokeAsync("JoinVoice", VoiceChannelId);
        return session;
    }

    private static async Task ConfigureAsync(Person owner, bool everyoneCanPlay, bool rateLimited) =>
        (await owner.Client.PatchAsJsonAsync(
            "/api/admin/soundboard/settings", new { everyoneCanPlay, rateLimited }))
            .EnsureSuccessStatusCode();

    private static async Task<string> CreateSoundAsync(Person owner)
    {
        var response = await owner.Client.PostAsJsonAsync("/api/admin/soundboard/sounds", new
        {
            attachmentId = await UploadWaveAsync(owner.Client, 4),
            name = "Gong",
            glyph = "🔔",
            trimStartSeconds = 0,
            trimEndSeconds = 2,
        });
        response.EnsureSuccessStatusCode();
        return (await JsonAsync(response)).GetProperty("id").GetString()!;
    }

    private static async Task<string> UploadWaveAsync(HttpClient client, double duration)
    {
        var wave = new byte[]
        {
            (byte)'R', (byte)'I', (byte)'F', (byte)'F', 4, 0, 0, 0,
            (byte)'W', (byte)'A', (byte)'V', (byte)'E', 0, 0, 0, 0,
        };
        using var form = new MultipartFormDataContent();
        using var audio = new ByteArrayContent(wave);
        audio.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("audio/wav");
        form.Add(audio, "file", "sound.wav");
        form.Add(
            new StringContent(duration.ToString(System.Globalization.CultureInfo.InvariantCulture)),
            "durationSeconds");
        var response = await client.PostAsync("/api/uploads", form);
        response.EnsureSuccessStatusCode();
        return (await JsonAsync(response)).GetProperty("id").GetString()!;
    }

    private static async Task<JsonElement> PreferencesAsync(Person person) =>
        (await JsonAsync(await person.Client.GetAsync("/api/me"))).GetProperty("preferences");

    private static async Task<string?> JoinSoundIdAsync(Person person) =>
        (await PreferencesAsync(person)).GetProperty("joinSoundId").GetString();

    private static async Task<JsonElement> JsonAsync(HttpResponseMessage response)
    {
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return document.RootElement.Clone();
    }

    private sealed record Person(HttpClient Client, string Cookie) : IDisposable
    {
        public void Dispose() => Client.Dispose();
    }

    private sealed class HubSession(HubConnection connection) : IAsyncDisposable
    {
        public HubConnection Connection { get; } = connection;

        public Channel<JsonElement> Played { get; } = Channel.CreateUnbounded<JsonElement>();

        public async Task<JsonElement> NextPlaybackAsync() =>
            await Played.Reader.ReadAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(2));

        public ValueTask DisposeAsync() => Connection.DisposeAsync();
    }
}
