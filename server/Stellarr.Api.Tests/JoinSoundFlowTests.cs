using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.SignalR.Client;

namespace Stellarr.Api.Tests;

/// <summary>
/// The clip a person is announced with: chosen in their own settings from the
/// soundboards of the servers they belong to, and cut to five seconds by the
/// server rather than by whoever is listening.
/// </summary>
public sealed class JoinSoundFlowTests : IClassFixture<StellarrWebApplicationFactory>
{
    private const string VoiceChannelId = "20000000-0000-0000-0000-000000000002";

    private readonly StellarrWebApplicationFactory _factory;

    public JoinSoundFlowTests(StellarrWebApplicationFactory factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task LibraryOffersServerSoundsCutToTheArrivalWindow()
    {
        using var owner = Client();
        await LoginAsync(owner, "maja", "Aurora!2026");
        var soundId = await CreateSoundAsync(owner, "Fanfara", "🎺", 1, 12, duration: 14);

        var library = await JsonAsync(await owner.GetAsync("/api/me/join-sound"));
        Assert.Equal(5, library.GetProperty("maxSeconds").GetDouble());
        var offered = library.GetProperty("servers").EnumerateArray()
            .SelectMany(server => server.GetProperty("sounds").EnumerateArray())
            .Single(sound => sound.GetProperty("id").GetString() == soundId);
        // Eleven seconds on the soundboard, five in a doorway.
        Assert.Equal(1, offered.GetProperty("trimStartSeconds").GetDouble(), 3);
        Assert.Equal(6, offered.GetProperty("trimEndSeconds").GetDouble(), 3);

        var saved = await owner.PatchAsJsonAsync(
            "/api/me/preferences",
            new { joinSoundId = soundId });
        saved.EnsureSuccessStatusCode();
        Assert.Equal(soundId, (await JsonAsync(saved)).GetProperty("joinSoundId").GetString());
        var account = await JsonAsync(await owner.GetAsync("/api/me"));
        Assert.Equal(
            soundId,
            account.GetProperty("preferences").GetProperty("joinSoundId").GetString());

        var unknown = await owner.PatchAsJsonAsync(
            "/api/me/preferences",
            new { joinSoundId = Guid.NewGuid().ToString() });
        Assert.Equal(HttpStatusCode.BadRequest, unknown.StatusCode);
        var stillChosen = await JsonAsync(await owner.GetAsync("/api/me"));
        Assert.Equal(
            soundId,
            stillChosen.GetProperty("preferences").GetProperty("joinSoundId").GetString());

        var cleared = await owner.PatchAsJsonAsync(
            "/api/me/preferences",
            new { joinSoundId = "" });
        cleared.EnsureSuccessStatusCode();
        Assert.Equal(
            JsonValueKind.Null,
            (await JsonAsync(cleared)).GetProperty("joinSoundId").ValueKind);

        await owner.DeleteAsync($"/api/admin/soundboard/sounds/{soundId}");
    }

    [Fact]
    public async Task HubAnnouncesTheArrivalOnceAndDroppingTheSoundClearsTheChoice()
    {
        using var owner = Client();
        await LoginAsync(owner, "maja", "Aurora!2026");
        var soundId = await CreateSoundAsync(owner, "Gong", "🔔", 0.5, 8.5, duration: 9);

        using var member = Client(handleCookies: false);
        var cookie = await SignInAsync(member, "ilya", "Meteor!2026");
        var chosen = await SendAsync(
            member,
            HttpMethod.Patch,
            "/api/me/preferences",
            cookie,
            new { joinSoundId = soundId });
        chosen.EnsureSuccessStatusCode();
        var memberId = (await JsonAsync(
            await SendAsync(member, HttpMethod.Get, "/api/me", cookie)))
            .GetProperty("id").GetString();

        await using var connection = new HubConnectionBuilder()
            .WithUrl("https://localhost/hubs/app", options =>
            {
                options.Headers["Cookie"] = cookie;
                options.Transports = HttpTransportType.LongPolling;
                options.HttpMessageHandlerFactory = _ => _factory.Server.CreateHandler();
            })
            .Build();
        var arrivals = new ConcurrentQueue<JsonElement>();
        var announced = new TaskCompletionSource<JsonElement>(
            TaskCreationOptions.RunContinuationsAsynchronously);
        connection.On<JsonElement>("JoinSoundPlayed", payload =>
        {
            arrivals.Enqueue(payload);
            announced.TrySetResult(payload);
        });

        await connection.StartAsync();
        await connection.InvokeAsync("JoinVoice", VoiceChannelId);
        var arrival = await announced.Task.WaitAsync(TimeSpan.FromSeconds(2));
        Assert.Equal(VoiceChannelId, arrival.GetProperty("channelId").GetString());
        Assert.Equal(memberId, arrival.GetProperty("triggeredByUserId").GetString());
        var sound = arrival.GetProperty("sound");
        Assert.Equal(soundId, sound.GetProperty("id").GetString());
        Assert.Equal(0.5, sound.GetProperty("trimStartSeconds").GetDouble(), 3);
        Assert.Equal(5.5, sound.GetProperty("trimEndSeconds").GetDouble(), 3);

        // Walking back in is not a second occasion: the cooldown silences the
        // announcement without ever refusing the join itself.
        await connection.InvokeAsync("LeaveVoice");
        await connection.InvokeAsync("JoinVoice", VoiceChannelId);
        await Task.Delay(TimeSpan.FromMilliseconds(500));
        Assert.Single(arrivals);
        await connection.InvokeAsync("LeaveVoice");
        await connection.StopAsync();

        var deleted = await owner.DeleteAsync($"/api/admin/soundboard/sounds/{soundId}");
        Assert.Equal(HttpStatusCode.NoContent, deleted.StatusCode);
        var account = await JsonAsync(
            await SendAsync(member, HttpMethod.Get, "/api/me", cookie));
        // The audio is collected with the sound, so the preference pointing at
        // it has to go too rather than becoming a setting that means silence.
        Assert.Equal(
            JsonValueKind.Null,
            account.GetProperty("preferences").GetProperty("joinSoundId").ValueKind);
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

    /// <summary>Signs in on a cookieless client and returns the header to reuse.</summary>
    private static async Task<string> SignInAsync(
        HttpClient client, string username, string password)
    {
        var response = await client.PostAsJsonAsync(
            "/api/auth/login",
            new { username, password });
        response.EnsureSuccessStatusCode();
        return string.Join(
            "; ",
            response.Headers.GetValues("Set-Cookie").Select(x => x.Split(';', 2)[0]));
    }

    private static Task<HttpResponseMessage> SendAsync(
        HttpClient client,
        HttpMethod method,
        string path,
        string cookie,
        object? body = null)
    {
        var request = new HttpRequestMessage(method, path);
        request.Headers.Add("Cookie", cookie);
        if (body is not null) request.Content = JsonContent.Create(body);
        return client.SendAsync(request);
    }

    private static async Task<string> CreateSoundAsync(
        HttpClient owner,
        string name,
        string glyph,
        double trimStartSeconds,
        double trimEndSeconds,
        double duration)
    {
        var attachmentId = await UploadWaveAsync(owner, duration);
        var response = await owner.PostAsJsonAsync("/api/admin/soundboard/sounds", new
        {
            attachmentId,
            name,
            glyph,
            trimStartSeconds,
            trimEndSeconds,
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

    private static async Task<JsonElement> JsonAsync(HttpResponseMessage response)
    {
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return document.RootElement.Clone();
    }
}
