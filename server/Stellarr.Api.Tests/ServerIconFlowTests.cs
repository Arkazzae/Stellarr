using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;

namespace Stellarr.Api.Tests;

public sealed class ServerIconFlowTests : IClassFixture<StellarrWebApplicationFactory>
{
    private static readonly byte[] TinyPng =
        [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

    private readonly StellarrWebApplicationFactory _factory;

    public ServerIconFlowTests(StellarrWebApplicationFactory factory) => _factory = factory;

    [Fact]
    public async Task OwnerCanUploadReplaceAndRemoveServerIcon()
    {
        using var owner = Client();
        using var member = Client();
        await LoginAsync(owner, "maja", "Aurora!2026");
        await LoginAsync(member, "jo", "Corona!2026");

        Assert.Equal(HttpStatusCode.Forbidden, (await UploadAsync(member, TinyPng)).StatusCode);

        var created = await UploadAsync(owner, TinyPng);
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var firstUrl = (await ReadJsonAsync(created)).GetProperty("iconUrl").GetString()
            ?? throw new InvalidOperationException("Upload did not return iconUrl.");
        Assert.StartsWith("/assets/", firstUrl, StringComparison.Ordinal);

        var bootstrap = await owner.GetFromJsonAsync<JsonElement>("/api/bootstrap");
        Assert.Equal(firstUrl, bootstrap.GetProperty("server").GetProperty("iconUrl").GetString());
        Assert.Equal(TinyPng, await owner.GetByteArrayAsync(firstUrl));

        var replaced = await UploadAsync(owner, TinyPng);
        var secondUrl = (await ReadJsonAsync(replaced)).GetProperty("iconUrl").GetString()
            ?? throw new InvalidOperationException("Replacement did not return iconUrl.");
        Assert.NotEqual(firstUrl, secondUrl);
        Assert.Equal(HttpStatusCode.NotFound, (await owner.GetAsync(firstUrl)).StatusCode);

        Assert.Equal(HttpStatusCode.Forbidden,
            (await member.DeleteAsync("/api/admin/server/icon")).StatusCode);
        Assert.Equal(HttpStatusCode.OK,
            (await owner.DeleteAsync("/api/admin/server/icon")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await owner.GetAsync(secondUrl)).StatusCode);

        bootstrap = await owner.GetFromJsonAsync<JsonElement>("/api/bootstrap");
        Assert.Equal(JsonValueKind.Null,
            bootstrap.GetProperty("server").GetProperty("iconUrl").ValueKind);
    }

    [Fact]
    public async Task UploadValidatesServerIconTypeAndSize()
    {
        using var owner = Client();
        await LoginAsync(owner, "maja", "Aurora!2026");

        Assert.Equal(HttpStatusCode.UnsupportedMediaType,
            (await UploadAsync(owner, "plain"u8.ToArray(), "text/plain")).StatusCode);
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge,
            (await UploadAsync(owner, new byte[4 * 1024 * 1024 + 1])).StatusCode);
    }

    private HttpClient Client() => _factory.CreateClient(
        new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            HandleCookies = true,
        });

    private static async Task<HttpResponseMessage> UploadAsync(
        HttpClient client,
        byte[] bytes,
        string contentType = "image/png")
    {
        using var body = new MultipartFormDataContent();
        var file = new ByteArrayContent(bytes);
        file.Headers.ContentType = MediaTypeHeaderValue.Parse(contentType);
        body.Add(file, "file", "server-icon.png");
        return await client.PostAsync("/api/admin/server/icon", body);
    }

    private static async Task LoginAsync(HttpClient client, string username, string password) =>
        (await client.PostAsJsonAsync("/api/auth/login", new { username, password }))
            .EnsureSuccessStatusCode();

    private static async Task<JsonElement> ReadJsonAsync(HttpResponseMessage response)
    {
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return document.RootElement.Clone();
    }
}
