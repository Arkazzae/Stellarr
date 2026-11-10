using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Stellarr.Api.Data;

namespace Stellarr.Api.Tests;

public sealed class AccountFlowTests
{
    [Fact]
    public async Task AccountProfilePreferencesImagesAndPasswordPersist()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var client = CreateClient(factory);
        (await client.PostAsJsonAsync("/api/auth/login", new
        {
            username = "jo",
            password = "Corona!2026",
        })).EnsureSuccessStatusCode();

        var initial = await ReadJsonAsync(await client.GetAsync("/api/me"));
        Assert.Equal("jo", initial.GetProperty("username").GetString());
        Assert.True(initial.GetProperty("preferences").GetProperty("messageSound").GetBoolean());
        Assert.False(initial.GetProperty("preferences").GetProperty("emailNotifications").GetBoolean());
        Assert.False(initial.GetProperty("preferences").GetProperty("pushNotifications").GetBoolean());
        Assert.Equal(60, initial.GetProperty("preferences").GetProperty("vadSensitivity").GetInt32());
        Assert.Equal(JsonValueKind.String, initial.GetProperty("createdAt").ValueKind);
        Assert.False(initial.TryGetProperty("tags", out _));

        var update = await client.PatchAsJsonAsync("/api/me", new
        {
            displayName = "Joanna",
            customStatus = "🎧 Słucham nowej płyty",
            bio = "Buduję rzeczy.",
            pronouns = "ona/jej",
        });
        update.EnsureSuccessStatusCode();
        var updated = await ReadJsonAsync(update);
        Assert.Equal("Joanna", updated.GetProperty("displayName").GetString());
        Assert.Equal("🎧 Słucham nowej płyty", updated.GetProperty("customStatus").GetString());
        Assert.Equal("Buduję rzeczy.", updated.GetProperty("bio").GetString());

        var mutedChannelId = Guid.NewGuid();
        var preferences = await client.PatchAsJsonAsync("/api/me/preferences", new
        {
            messageSound = false,
            reducedMotion = true,
            emailNotifications = true,
            pushNotifications = true,
            mutedChannelIds = new[] { mutedChannelId, mutedChannelId },
            vadSensitivity = 85,
        });
        preferences.EnsureSuccessStatusCode();
        var preferencesJson = await ReadJsonAsync(preferences);
        Assert.False(preferencesJson.GetProperty("messageSound").GetBoolean());
        Assert.True(preferencesJson.GetProperty("reducedMotion").GetBoolean());
        Assert.True(preferencesJson.GetProperty("emailNotifications").GetBoolean());
        Assert.True(preferencesJson.GetProperty("pushNotifications").GetBoolean());
        Assert.Equal(
            new[] { mutedChannelId.ToString() },
            preferencesJson.GetProperty("mutedChannelIds").EnumerateArray().Select(x => x.GetString()));
        Assert.Equal(85, preferencesJson.GetProperty("vadSensitivity").GetInt32());

        var png = new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0 };
        using var form = new MultipartFormDataContent();
        var image = new ByteArrayContent(png);
        image.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("image/png");
        form.Add(image, "file", "avatar.png");
        var upload = await client.PostAsync("/api/me/images/avatar", form);
        Assert.Equal(HttpStatusCode.Created, upload.StatusCode);
        var uploadJson = await ReadJsonAsync(upload);
        var avatarUrl = uploadJson.GetProperty("avatarUrl").GetString();
        Assert.StartsWith("/assets/", avatarUrl, StringComparison.Ordinal);

        var asset = await client.GetAsync(avatarUrl);
        Assert.Equal(HttpStatusCode.OK, asset.StatusCode);
        Assert.Equal(png, await asset.Content.ReadAsByteArrayAsync());

        var remove = await client.DeleteAsync("/api/me/images/avatar");
        remove.EnsureSuccessStatusCode();
        var removed = await ReadJsonAsync(remove);
        Assert.Equal(JsonValueKind.Null, removed.GetProperty("avatarUrl").ValueKind);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(avatarUrl)).StatusCode);

        Assert.Equal("wrong-current", await ChangePasswordAsync(client, "wrong", "NewCorona!2026"));
        Assert.Equal("too-short", await ChangePasswordAsync(client, "Corona!2026", "short"));
        Assert.Equal("same-as-current", await ChangePasswordAsync(client, "Corona!2026", "Corona!2026"));
        Assert.Equal("changed", await ChangePasswordAsync(client, "Corona!2026", "NewCorona!2026"));

        var persisted = await ReadJsonAsync(await client.GetAsync("/api/me"));
        Assert.Equal("Joanna", persisted.GetProperty("displayName").GetString());
        Assert.Equal("🎧 Słucham nowej płyty", persisted.GetProperty("customStatus").GetString());
        Assert.Equal("Buduję rzeczy.", persisted.GetProperty("bio").GetString());
        Assert.False(persisted.GetProperty("preferences").GetProperty("messageSound").GetBoolean());
        Assert.True(persisted.GetProperty("preferences").GetProperty("emailNotifications").GetBoolean());
        Assert.True(persisted.GetProperty("preferences").GetProperty("pushNotifications").GetBoolean());
        Assert.Equal(
            new[] { mutedChannelId.ToString() },
            persisted.GetProperty("preferences").GetProperty("mutedChannelIds").EnumerateArray().Select(x => x.GetString()));
        Assert.Equal(85, persisted.GetProperty("preferences").GetProperty("vadSensitivity").GetInt32());

        await client.PostAsync("/api/auth/logout", null);
        Assert.Equal(
            HttpStatusCode.Unauthorized,
            (await client.PostAsJsonAsync("/api/auth/login", new { username = "jo", password = "Corona!2026" })).StatusCode);
        Assert.Equal(
            HttpStatusCode.OK,
            (await client.PostAsJsonAsync("/api/auth/login", new { username = "jo", password = "NewCorona!2026" })).StatusCode);
    }

    [Fact]
    public async Task AccountEndpointsRequireAuthenticationAndValidateProfile()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var anonymous = factory.CreateClient(new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            HandleCookies = false,
        });
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync("/api/me")).StatusCode);

        using var client = CreateClient(factory);
        (await client.PostAsJsonAsync("/api/auth/login", new
        {
            username = "nils",
            password = "Zenith!2026",
        })).EnsureSuccessStatusCode();

        var response = await client.PatchAsJsonAsync("/api/me", new
        {
            displayName = " ",
        });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);

        var invalidStatus = await client.PatchAsJsonAsync("/api/me", new
        {
            customStatus = new string('x', 129),
        });
        Assert.Equal(HttpStatusCode.BadRequest, invalidStatus.StatusCode);

        var invalidVad = await client.PatchAsJsonAsync("/api/me/preferences", new
        {
            vadSensitivity = 101,
        });
        Assert.Equal(HttpStatusCode.BadRequest, invalidVad.StatusCode);
    }

    private static HttpClient CreateClient(StellarrWebApplicationFactory factory) =>
        factory.CreateClient(new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            HandleCookies = true,
        });

    private static async Task<string> ChangePasswordAsync(HttpClient client, string current, string next)
    {
        var response = await client.PostAsJsonAsync("/api/me/password", new
        {
            currentPassword = current,
            newPassword = next,
        });
        response.EnsureSuccessStatusCode();
        return (await ReadJsonAsync(response)).GetProperty("result").GetString() ?? "";
    }

    private static async Task<JsonElement> ReadJsonAsync(HttpResponseMessage response)
    {
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return document.RootElement.Clone();
    }
}
