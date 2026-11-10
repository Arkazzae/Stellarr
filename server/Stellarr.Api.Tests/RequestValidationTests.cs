using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Stellarr.Api.Data;

namespace Stellarr.Api.Tests;

public sealed class RequestValidationTests : IClassFixture<StellarrWebApplicationFactory>
{
    private readonly StellarrWebApplicationFactory _factory;

    public RequestValidationTests(StellarrWebApplicationFactory factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task NullRequiredTextFieldsReturnValidationErrors()
    {
        using var client = _factory.CreateClient(new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            HandleCookies = true,
        });
        (await client.PostAsJsonAsync(
            "/api/auth/login",
            new { username = "maja", password = "Aurora!2026" })).EnsureSuccessStatusCode();

        var createMessage = await client.PostAsJsonAsync(
            $"/api/channels/{TestData.GeneralChannelId}/messages",
            new { content = (string?)null, attachmentIds = Array.Empty<string>() });
        Assert.Equal(HttpStatusCode.BadRequest, createMessage.StatusCode);

        var editMessage = await client.PatchAsJsonAsync(
            $"/api/messages/{Guid.NewGuid()}",
            new { content = (string?)null });
        Assert.Equal(HttpStatusCode.BadRequest, editMessage.StatusCode);

        var friendRequest = await client.PostAsJsonAsync(
            "/api/social/requests",
            new { username = (string?)null });
        Assert.Equal(HttpStatusCode.BadRequest, friendRequest.StatusCode);

        var opened = await client.PostAsJsonAsync(
            "/api/social/conversations",
            new { userId = "30000000-0000-0000-0000-000000000002" });
        opened.EnsureSuccessStatusCode();
        using var openedJson = JsonDocument.Parse(await opened.Content.ReadAsStringAsync());
        var conversationId = openedJson.RootElement.GetProperty("id").GetString();
        var directMessage = await client.PostAsJsonAsync(
            $"/api/social/conversations/{conversationId}/messages",
            new { content = (string?)null });
        Assert.Equal(HttpStatusCode.BadRequest, directMessage.StatusCode);

        var role = await client.PostAsJsonAsync(
            "/api/admin/roles",
            new
            {
                name = (string?)null,
                color = (string?)null,
                permissions = Array.Empty<string>(),
            });
        Assert.Equal(HttpStatusCode.BadRequest, role.StatusCode);
    }
}
