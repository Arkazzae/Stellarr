using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;

namespace Stellarr.Api.Tests;

public sealed class EmojiFlowTests : IClassFixture<StellarrWebApplicationFactory>
{
    private static readonly byte[] TinyPng =
        [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

    private readonly StellarrWebApplicationFactory _factory;

    public EmojiFlowTests(StellarrWebApplicationFactory factory) => _factory = factory;

    [Fact]
    public async Task OwnerCanUploadAndDeleteEmojiThatEveryMemberCanRead()
    {
        using var owner = Client();
        using var member = Client();
        await LoginAsync(owner, "maja", "Aurora!2026");
        await LoginAsync(member, "jo", "Corona!2026");

        Assert.Equal(HttpStatusCode.Forbidden,
            (await UploadAsync(member, "mushris", TinyPng)).StatusCode);

        var created = await UploadAsync(owner, ":mushris:", TinyPng);
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        using var createdJson = JsonDocument.Parse(await created.Content.ReadAsStringAsync());
        var id = createdJson.RootElement.GetProperty("id").GetString();
        Assert.Equal(":mushris:", createdJson.RootElement.GetProperty("shortcode").GetString());
        var glyph = createdJson.RootElement.GetProperty("glyph").GetString();
        Assert.StartsWith($"/api/emoji/{id}/image?serverId=", glyph);

        var list = await member.GetFromJsonAsync<JsonElement[]>("/api/emoji");
        Assert.Single(list!);
        Assert.Equal(":mushris:", list![0].GetProperty("shortcode").GetString());

        var image = await member.GetAsync(glyph);
        Assert.Equal(HttpStatusCode.OK, image.StatusCode);
        Assert.Equal("image/png", image.Content.Headers.ContentType?.MediaType);
        Assert.Equal(TinyPng, await image.Content.ReadAsByteArrayAsync());

        Assert.Equal(HttpStatusCode.Conflict,
            (await UploadAsync(owner, "mushris", TinyPng)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await member.DeleteAsync($"/api/emoji/{id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent,
            (await owner.DeleteAsync($"/api/emoji/{id}")).StatusCode);
        Assert.Empty((await member.GetFromJsonAsync<JsonElement[]>("/api/emoji"))!);
        Assert.Equal(HttpStatusCode.NotFound,
            (await member.GetAsync(glyph)).StatusCode);
    }

    [Fact]
    public async Task UploadValidatesNameImageTypeAndSize()
    {
        using var owner = Client();
        await LoginAsync(owner, "maja", "Aurora!2026");

        Assert.Equal(HttpStatusCode.BadRequest,
            (await UploadAsync(owner, "!", TinyPng)).StatusCode);
        Assert.Equal(HttpStatusCode.UnsupportedMediaType,
            (await UploadAsync(owner, "plain", "not an image"u8.ToArray(), "text/plain")).StatusCode);
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge,
            (await UploadAsync(owner, "huge", new byte[512 * 1024 + 1])).StatusCode);
    }

    private HttpClient Client() => _factory.CreateClient(
        new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            HandleCookies = true,
        });

    private static async Task<HttpResponseMessage> UploadAsync(
        HttpClient client,
        string shortcode,
        byte[] bytes,
        string contentType = "image/png")
    {
        using var body = new MultipartFormDataContent();
        body.Add(new StringContent(shortcode), "shortcode");
        var file = new ByteArrayContent(bytes);
        file.Headers.ContentType = MediaTypeHeaderValue.Parse(contentType);
        body.Add(file, "file", "emoji.png");
        return await client.PostAsync("/api/emoji", body);
    }

    private static async Task LoginAsync(HttpClient client, string username, string password) =>
        (await client.PostAsJsonAsync("/api/auth/login", new { username, password }))
            .EnsureSuccessStatusCode();
}
