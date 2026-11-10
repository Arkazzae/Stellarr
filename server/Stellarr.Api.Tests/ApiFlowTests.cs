using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;

namespace Stellarr.Api.Tests;

public sealed class ApiFlowTests : IClassFixture<StellarrWebApplicationFactory>
{
    private readonly StellarrWebApplicationFactory _factory;
    private readonly HttpClient _client;

    public ApiFlowTests(StellarrWebApplicationFactory factory)
    {
        _factory = factory;
        _client = factory.CreateClient(new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            HandleCookies = true,
        });
    }

    [Theory]
    [InlineData("maja", "Aurora!2026")]
    [InlineData("ada", "Quasar!2026")]
    [InlineData("ilya", "Meteor!2026")]
    public async Task TestUserCanLogInAndReadBootstrap(string username, string password)
    {
        var login = await _client.PostAsJsonAsync("/api/auth/login", new { username, password });
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);

        var bootstrap = await _client.GetAsync("/api/bootstrap");
        Assert.Equal(HttpStatusCode.OK, bootstrap.StatusCode);
        using var document = JsonDocument.Parse(await bootstrap.Content.ReadAsStringAsync());
        Assert.Equal("Orbit", document.RootElement.GetProperty("server").GetProperty("name").GetString());
        Assert.Equal(username, document.RootElement.GetProperty("user").GetProperty("username").GetString());
        Assert.Equal(5, document.RootElement.GetProperty("channels").GetArrayLength());
        Assert.Equal(5, document.RootElement.GetProperty("members").GetArrayLength());
        var rtc = document.RootElement.GetProperty("rtc");
        Assert.Equal(1, rtc.GetProperty("protocolVersion").GetInt32());
        Assert.Equal("mesh", rtc.GetProperty("topology").GetString());
        Assert.Contains("opus", rtc.GetProperty("capabilities").GetProperty("audioCodecs").EnumerateArray().Select(x => x.GetString()));
        Assert.True(rtc.GetProperty("capabilities").GetProperty("camera").GetBoolean());
        var iceServers = rtc.GetProperty("iceServers");
        Assert.Equal("stun:localhost:3480", iceServers[0].GetProperty("urls")[0].GetString());
        Assert.Equal("turn:localhost:3480?transport=udp", iceServers[1].GetProperty("urls")[0].GetString());
        Assert.Equal("turn:localhost:3480?transport=tcp", iceServers[1].GetProperty("urls")[1].GetString());
        Assert.Equal("turns:localhost:5350?transport=tcp", iceServers[2].GetProperty("urls")[0].GetString());
        var turnCredential = iceServers[1].GetProperty("credential").GetString();
        Assert.False(string.IsNullOrEmpty(turnCredential));
    }

    [Fact]
    public async Task BootstrapCanLimitTurnToUdpForASmallRelayRange()
    {
        using var factory = new StellarrWebApplicationFactory(
            loadTestData: true,
            configuration: new Dictionary<string, string?>
            {
                ["Rtc:TurnTcpEnabled"] = "false",
                ["Rtc:TurnsEnabled"] = "false",
            });
        using var client = factory.CreateClient(new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            HandleCookies = true,
        });
        var login = await client.PostAsJsonAsync(
            "/api/auth/login",
            new { username = "maja", password = "Aurora!2026" });
        login.EnsureSuccessStatusCode();

        var bootstrap = await client.GetFromJsonAsync<JsonElement>("/api/bootstrap");
        var iceServers = bootstrap.GetProperty("rtc").GetProperty("iceServers");

        Assert.Equal(2, iceServers.GetArrayLength());
        var turnUrls = iceServers[1].GetProperty("urls");
        Assert.Equal(1, turnUrls.GetArrayLength());
        Assert.Equal("turn:localhost:3480?transport=udp", turnUrls[0].GetString());
    }

    [Fact]
    public async Task InvalidPasswordIsRejected()
    {
        var response = await _client.PostAsJsonAsync("/api/auth/login", new { username = "maja", password = "wrong" });
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task AnonymousSessionCheckReturnsNullWithoutAChallenge()
    {
        using var anonymous = _factory.CreateClient(new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            HandleCookies = false,
        });

        var response = await anonymous.GetAsync("/api/session");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(JsonValueKind.Null, document.RootElement.GetProperty("user").ValueKind);
    }

    [Fact]
    public async Task LoggedInSessionCheckReturnsTheCurrentUser()
    {
        var login = await _client.PostAsJsonAsync("/api/auth/login", new { username = "ada", password = "Quasar!2026" });
        login.EnsureSuccessStatusCode();

        var response = await _client.GetAsync("/api/session");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal("ada", document.RootElement.GetProperty("user").GetProperty("username").GetString());
    }

    [Fact]
    public async Task FirstRegistrationBootstrapsAnEmptyProductionInstance()
    {
        using var factory = new StellarrWebApplicationFactory(loadTestData: false);
        using var client = factory.CreateClient(new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            HandleCookies = true,
        });

        var registration = await client.PostAsJsonAsync("/api/auth/register", new
        {
            username = "owner",
            displayName = "First Owner",
            email = "owner@example.test",
            password = "Production!2026",
        });
        Assert.Equal(HttpStatusCode.Created, registration.StatusCode);

        var bootstrap = await client.GetFromJsonAsync<JsonElement>("/api/bootstrap");
        Assert.Equal("Stellarr", bootstrap.GetProperty("server").GetProperty("name").GetString());
        Assert.Equal(2, bootstrap.GetProperty("channels").GetArrayLength());
        Assert.Contains("manageServer", bootstrap.GetProperty("permissions").EnumerateArray()
            .Select(permission => permission.GetString()));
        var welcome = Assert.Single(bootstrap.GetProperty("messages").EnumerateArray());
        Assert.Equal("system", welcome.GetProperty("author").GetProperty("id").GetString());
        Assert.Equal("system", welcome.GetProperty("author").GetProperty("displayName").GetString());
        Assert.Equal(
            "<b>First Owner</b> dołącza do serwera. Przywitajcie się!",
            welcome.GetProperty("content").GetString());

        var giphy = await client.GetFromJsonAsync<JsonElement>("/api/config/giphy");
        Assert.Equal(JsonValueKind.String, giphy.GetProperty("apiKey").ValueKind);
    }

    [Fact]
    public async Task AnonymousMessageCreationIsRejected()
    {
        using var anonymous = _factory.CreateClient(new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            HandleCookies = false,
        });
        var response = await anonymous.PostAsJsonAsync(
            "/api/channels/20000000-0000-0000-0000-000000000001/messages",
            new { content = "hello", attachmentIds = Array.Empty<string>() });
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task LongCodeMessageUsesTheSharedContentLimit()
    {
        var login = await _client.PostAsJsonAsync(
            "/api/auth/login",
            new { username = "maja", password = "Aurora!2026" });
        login.EnsureSuccessStatusCode();

        var acceptedContent = "```ts\n" +
            new string('x', MessageLimits.MaxContentLength - 10) +
            "\n```";
        Assert.Equal(MessageLimits.MaxContentLength, acceptedContent.Length);

        var accepted = await _client.PostAsJsonAsync(
            $"/api/channels/{TestData.GeneralChannelId}/messages",
            new { content = acceptedContent, attachmentIds = Array.Empty<string>() });
        Assert.Equal(HttpStatusCode.Created, accepted.StatusCode);

        var rejected = await _client.PostAsJsonAsync(
            $"/api/channels/{TestData.GeneralChannelId}/messages",
            new
            {
                content = acceptedContent + "x",
                attachmentIds = Array.Empty<string>(),
            });
        Assert.Equal(HttpStatusCode.BadRequest, rejected.StatusCode);
    }

    [Fact]
    public async Task ChannelHistoryPagesBackwardsWithoutBeingShiftedByNewMessages()
    {
        var login = await _client.PostAsJsonAsync("/api/auth/login", new { username = "maja", password = "Aurora!2026" });
        login.EnsureSuccessStatusCode();

        var channelId = Guid.NewGuid();
        var ids = Enumerable.Range(1, 5)
            .Select(index => Guid.Parse($"30000000-0000-0000-0000-{index:D12}"))
            .ToArray();
        await using (var scope = _factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var authorId = await Microsoft.EntityFrameworkCore.EntityFrameworkQueryableExtensions.SingleAsync(
                db.Users.Where(x => x.Username == "maja").Select(x => x.Id));
            db.Channels.Add(new Channel
            {
                Id = channelId,
                ServerId = TestData.ServerId,
                Name = $"history-{channelId:N}",
                Kind = ChannelKind.Text,
                Position = 100,
            });
            var baseTime = DateTime.UtcNow.AddHours(-1);
            db.Messages.AddRange(ids.Select((id, index) => new Message
            {
                Id = id,
                ChannelId = channelId,
                AuthorId = authorId,
                Content = $"history-{index + 1}",
                CreatedAt = baseTime.AddMinutes(index),
            }));
            await db.SaveChangesAsync();
        }

        var first = await ReadHistoryPageAsync($"/api/channels/{channelId}/messages?limit=2");
        Assert.Equal(["history-4", "history-5"], MessageContents(first));
        var firstCursor = first.GetProperty("nextCursor").GetString();
        Assert.False(string.IsNullOrEmpty(firstCursor));

        // This row is newer than the snapshot encoded in firstCursor. It must
        // appear on a fresh first page but must not shift the older pages.
        var created = await _client.PostAsJsonAsync(
            $"/api/channels/{channelId}/messages",
            new { content = "history-6", attachmentIds = Array.Empty<string>() });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);

        var second = await ReadHistoryPageAsync(
            $"/api/channels/{channelId}/messages?limit=2&cursor={Uri.EscapeDataString(firstCursor!)}");
        Assert.Equal(["history-2", "history-3"], MessageContents(second));
        var secondCursor = second.GetProperty("nextCursor").GetString();

        var third = await ReadHistoryPageAsync(
            $"/api/channels/{channelId}/messages?limit=2&cursor={Uri.EscapeDataString(secondCursor!)}");
        Assert.Equal(["history-1"], MessageContents(third));
        Assert.Equal(JsonValueKind.Null, third.GetProperty("nextCursor").ValueKind);

        var fresh = await ReadHistoryPageAsync($"/api/channels/{channelId}/messages?limit=2");
        Assert.Equal("history-6", MessageContents(fresh).Last());

        await using var cleanup = _factory.Services.CreateAsyncScope();
        var cleanupDb = cleanup.ServiceProvider.GetRequiredService<AppDbContext>();
        var channel = await cleanupDb.Channels.FindAsync(channelId);
        if (channel is not null)
        {
            cleanupDb.Channels.Remove(channel);
            await cleanupDb.SaveChangesAsync();
        }
    }

    [Fact]
    public async Task ChannelHistoryValidatesAccessChannelKindAndPagingInput()
    {
        using var anonymous = _factory.CreateClient(new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            HandleCookies = false,
        });
        var unauthorized = await anonymous.GetAsync($"/api/channels/{TestData.GeneralChannelId}/messages");
        Assert.Equal(HttpStatusCode.Unauthorized, unauthorized.StatusCode);

        var login = await _client.PostAsJsonAsync("/api/auth/login", new { username = "ada", password = "Quasar!2026" });
        login.EnsureSuccessStatusCode();
        Assert.Equal(
            HttpStatusCode.NotFound,
            (await _client.GetAsync($"/api/channels/{TestData.VoiceChannelId}/messages")).StatusCode);
        Assert.Equal(
            HttpStatusCode.BadRequest,
            (await _client.GetAsync($"/api/channels/{TestData.GeneralChannelId}/messages?limit=101")).StatusCode);
        Assert.Equal(
            HttpStatusCode.BadRequest,
            (await _client.GetAsync($"/api/channels/{TestData.GeneralChannelId}/messages?cursor=broken")).StatusCode);
    }

    [Fact]
    public async Task LoggedInUserCanUploadPngAndCreateMessage()
    {
        var login = await _client.PostAsJsonAsync("/api/auth/login", new { username = "maja", password = "Aurora!2026" });
        login.EnsureSuccessStatusCode();

        var png = new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0 };
        using var form = new MultipartFormDataContent();
        var image = new ByteArrayContent(png);
        image.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("image/png");
        form.Add(image, "file", "tiny.png");
        var upload = await _client.PostAsync("/api/uploads", form);
        Assert.Equal(HttpStatusCode.Created, upload.StatusCode);

        using var uploadJson = JsonDocument.Parse(await upload.Content.ReadAsStringAsync());
        var attachmentId = uploadJson.RootElement.GetProperty("id").GetString();
        var message = await _client.PostAsJsonAsync(
            "/api/channels/20000000-0000-0000-0000-000000000001/messages",
            new { content = "obraz testowy", attachmentIds = new[] { attachmentId } });
        Assert.Equal(HttpStatusCode.Created, message.StatusCode);
    }

    [Fact]
    public async Task GenericDocumentsAreDownloadedAndMessagesRejectMoreThanTenAttachments()
    {
        var login = await _client.PostAsJsonAsync(
            "/api/auth/login", new { username = "maja", password = "Aurora!2026" });
        login.EnsureSuccessStatusCode();

        using var form = new MultipartFormDataContent();
        var document = new ByteArrayContent("%PDF-1.7\n%%EOF\n"u8.ToArray());
        document.Headers.ContentType =
            new System.Net.Http.Headers.MediaTypeHeaderValue("application/pdf");
        // The verified media type, not a client-provided executable suffix,
        // decides which filename the recipient downloads.
        form.Add(document, "file", "release notes.exe");
        var upload = await _client.PostAsync("/api/uploads", form);
        Assert.Equal(HttpStatusCode.Created, upload.StatusCode);
        using var uploaded = JsonDocument.Parse(await upload.Content.ReadAsStringAsync());
        Assert.Equal("release notes.pdf", uploaded.RootElement.GetProperty("name").GetString());

        var download = await _client.GetAsync(uploaded.RootElement.GetProperty("url").GetString());
        Assert.Equal(HttpStatusCode.OK, download.StatusCode);
        Assert.Equal("attachment", download.Content.Headers.ContentDisposition?.DispositionType);
        Assert.Contains("release%20notes.pdf", download.Content.Headers.ContentDisposition?.ToString());
        Assert.Equal("nosniff", download.Headers.GetValues("X-Content-Type-Options").Single());

        var tooMany = await _client.PostAsJsonAsync(
            $"/api/channels/{TestData.GeneralChannelId}/messages",
            new
            {
                content = "za dużo",
                attachmentIds = Enumerable.Range(0, 11).Select(_ => Guid.NewGuid()).ToArray(),
            });
        Assert.Equal(HttpStatusCode.BadRequest, tooMany.StatusCode);
        using var error = JsonDocument.Parse(await tooMany.Content.ReadAsStringAsync());
        Assert.True(error.RootElement.GetProperty("errors").TryGetProperty("attachmentIds", out _));
    }

    [Fact]
    public async Task LoggedInUserCanUploadAudioAndVideoAndCreateAttachmentOnlyMessage()
    {
        var login = await _client.PostAsJsonAsync("/api/auth/login", new { username = "maja", password = "Aurora!2026" });
        login.EnsureSuccessStatusCode();

        var wave = new byte[]
        {
            (byte)'R', (byte)'I', (byte)'F', (byte)'F', 4, 0, 0, 0,
            (byte)'W', (byte)'A', (byte)'V', (byte)'E', 0, 0, 0, 0,
        };
        var mp4 = new byte[]
        {
            0, 0, 0, 16, (byte)'f', (byte)'t', (byte)'y', (byte)'p',
            (byte)'i', (byte)'s', (byte)'o', (byte)'m', 0, 0, 0, 0,
        };

        var audio = await UploadMediaAsync(wave, "audio/wav", "sample.wav");
        var video = await UploadMediaAsync(mp4, "video/mp4", "sample.mp4");

        Assert.Equal("audio/wav", audio.GetProperty("contentType").GetString());
        Assert.Equal("video/mp4", video.GetProperty("contentType").GetString());

        var attachmentIds = new[]
        {
            audio.GetProperty("id").GetString(),
            video.GetProperty("id").GetString(),
        };
        var message = await _client.PostAsJsonAsync(
            "/api/channels/20000000-0000-0000-0000-000000000001/messages",
            new { content = "", attachmentIds });

        Assert.Equal(HttpStatusCode.Created, message.StatusCode);
        using var messageJson = JsonDocument.Parse(await message.Content.ReadAsStringAsync());
        var attachments = messageJson.RootElement.GetProperty("attachments");
        Assert.Equal(2, attachments.GetArrayLength());
        Assert.Contains(attachments.EnumerateArray(), item => item.GetProperty("contentType").GetString() == "audio/wav");
        Assert.Contains(attachments.EnumerateArray(), item => item.GetProperty("contentType").GetString() == "video/mp4");

        var asset = await _client.GetAsync(audio.GetProperty("url").GetString());
        Assert.Equal(HttpStatusCode.OK, asset.StatusCode);
        Assert.Equal("audio/wav", asset.Content.Headers.ContentType?.MediaType);
        Assert.Equal(wave, await asset.Content.ReadAsByteArrayAsync());

        using var voiceForm = new MultipartFormDataContent();
        var recordedAudio = new ByteArrayContent(wave);
        recordedAudio.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("audio/wav");
        voiceForm.Add(recordedAudio, "file", "wiadomosc-glosowa.wav");
        voiceForm.Add(new StringContent("4.125"), "durationSeconds");
        voiceForm.Add(new StringContent("true"), "voiceMessage");

        var voiceUpload = await _client.PostAsync("/api/uploads", voiceForm);
        Assert.Equal(HttpStatusCode.Created, voiceUpload.StatusCode);
        using var uploadJson = JsonDocument.Parse(await voiceUpload.Content.ReadAsStringAsync());
        var voiceAttachment = uploadJson.RootElement;
        Assert.True(voiceAttachment.GetProperty("isVoiceMessage").GetBoolean());
        Assert.Equal(4.125, voiceAttachment.GetProperty("durationSeconds").GetDouble(), 3);

        var voiceAttachmentId = voiceAttachment.GetProperty("id").GetString();
        var voiceMessage = await _client.PostAsJsonAsync(
            "/api/channels/20000000-0000-0000-0000-000000000001/messages",
            new { content = "", attachmentIds = new[] { voiceAttachmentId } });

        Assert.Equal(HttpStatusCode.Created, voiceMessage.StatusCode);
        using var voiceMessageJson = JsonDocument.Parse(await voiceMessage.Content.ReadAsStringAsync());
        Assert.True(voiceMessageJson.RootElement.GetProperty("attachments")[0]
            .GetProperty("isVoiceMessage").GetBoolean());

        var mixed = await _client.PostAsJsonAsync(
            "/api/channels/20000000-0000-0000-0000-000000000001/messages",
            new { content = "tekst obok nagrania", attachmentIds = new[] { voiceAttachmentId } });
        Assert.Equal(HttpStatusCode.BadRequest, mixed.StatusCode);

        using var longForm = new MultipartFormDataContent();
        var longAudio = new ByteArrayContent(wave);
        longAudio.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("audio/wav");
        longForm.Add(longAudio, "file", "za-dluga.wav");
        longForm.Add(new StringContent("601"), "durationSeconds");
        longForm.Add(new StringContent("true"), "voiceMessage");
        Assert.Equal(HttpStatusCode.BadRequest, (await _client.PostAsync("/api/uploads", longForm)).StatusCode);

        var png = new byte[] { 137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0 };
        using var imageForm = new MultipartFormDataContent();
        var image = new ByteArrayContent(png);
        image.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("image/png");
        imageForm.Add(image, "file", "notatka.png");
        imageForm.Add(new StringContent("2"), "durationSeconds");
        imageForm.Add(new StringContent("true"), "voiceMessage");
        Assert.Equal(HttpStatusCode.BadRequest, (await _client.PostAsync("/api/uploads", imageForm)).StatusCode);
    }

    [Fact]
    public async Task VideoUploadPersistsMeasuredMetadataAndItsPoster()
    {
        var login = await _client.PostAsJsonAsync("/api/auth/login", new { username = "maja", password = "Aurora!2026" });
        login.EnsureSuccessStatusCode();

        var mp4 = new byte[]
        {
            0, 0, 0, 16, (byte)'f', (byte)'t', (byte)'y', (byte)'p',
            (byte)'i', (byte)'s', (byte)'o', (byte)'m', 0, 0, 0, 0,
        };
        var jpeg = new byte[] { 0xFF, 0xD8, 0xFF, 0xE0, 0, 0, 0, 0 };
        using var form = new MultipartFormDataContent();
        var video = new ByteArrayContent(mp4);
        video.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("video/mp4");
        form.Add(video, "file", "clip.mp4");
        form.Add(new StringContent("42.125"), "durationSeconds");
        form.Add(new StringContent("1920"), "width");
        form.Add(new StringContent("1080"), "height");
        var poster = new ByteArrayContent(jpeg);
        poster.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("image/jpeg");
        form.Add(poster, "poster", "poster.jpg");

        var upload = await _client.PostAsync("/api/uploads", form);

        Assert.Equal(HttpStatusCode.Created, upload.StatusCode);
        using var document = JsonDocument.Parse(await upload.Content.ReadAsStringAsync());
        var attachment = document.RootElement;
        Assert.Equal(42.125, attachment.GetProperty("durationSeconds").GetDouble(), 3);
        Assert.Equal(1920, attachment.GetProperty("width").GetInt32());
        Assert.Equal(1080, attachment.GetProperty("height").GetInt32());
        var posterUrl = attachment.GetProperty("posterUrl").GetString();
        Assert.False(string.IsNullOrWhiteSpace(posterUrl));

        var storedPoster = await _client.GetAsync(posterUrl);
        Assert.Equal(HttpStatusCode.OK, storedPoster.StatusCode);
        Assert.Equal("image/jpeg", storedPoster.Content.Headers.ContentType?.MediaType);
        Assert.Equal(jpeg, await storedPoster.Content.ReadAsByteArrayAsync());
    }

    [Fact]
    public async Task UploadRejectsMediaWhoseBytesDoNotMatchItsDeclaredType()
    {
        var login = await _client.PostAsJsonAsync("/api/auth/login", new { username = "maja", password = "Aurora!2026" });
        login.EnsureSuccessStatusCode();

        using var form = new MultipartFormDataContent();
        var fakeAudio = new ByteArrayContent("not really an mp3"u8.ToArray());
        fakeAudio.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("audio/mpeg");
        form.Add(fakeAudio, "file", "fake.mp3");

        var response = await _client.PostAsync("/api/uploads", form);

        Assert.Equal(HttpStatusCode.UnsupportedMediaType, response.StatusCode);
    }

    private async Task<JsonElement> UploadMediaAsync(byte[] bytes, string contentType, string fileName)
    {
        using var form = new MultipartFormDataContent();
        var media = new ByteArrayContent(bytes);
        media.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue(contentType);
        form.Add(media, "file", fileName);

        var response = await _client.PostAsync("/api/uploads", form);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return document.RootElement.Clone();
    }

    private async Task<JsonElement> ReadHistoryPageAsync(string path)
    {
        var response = await _client.GetAsync(path);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return document.RootElement.Clone();
    }

    private static string[] MessageContents(JsonElement page) =>
        page.GetProperty("messages")
            .EnumerateArray()
            .Select(message => message.GetProperty("content").GetString()!)
            .ToArray();
}
