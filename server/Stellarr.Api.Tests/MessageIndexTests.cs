using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;

namespace Stellarr.Api.Tests;

public sealed class MessageIndexTests : IClassFixture<StellarrWebApplicationFactory>
{
    private readonly StellarrWebApplicationFactory _factory;
    private readonly HttpClient _client;

    public MessageIndexTests(StellarrWebApplicationFactory factory)
    {
        _factory = factory;
        _client = factory.CreateClient(new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            HandleCookies = true,
        });
    }

    [Fact]
    public async Task FullTextIndexFoldsDiacriticsAndTracksEditsAndDeletes()
    {
        await LoginAsync();
        var token = Guid.NewGuid().ToString("N")[..8];
        var created = await _client.PostAsJsonAsync(
            $"/api/channels/{TestData.GeneralChannelId}/messages",
            new
            {
                content = $"Żółw planuje orbitę {token}",
                attachmentIds = Array.Empty<string>(),
            });
        created.EnsureSuccessStatusCode();
        var message = await created.Content.ReadFromJsonAsync<JsonElement>();
        var messageId = message.GetProperty("id").GetString();

        Assert.Contains(messageId, await SearchIdsAsync($"zolw {token}"));

        var edited = await _client.PatchAsJsonAsync(
            $"/api/messages/{messageId}",
            new { content = $"Galaktyczny atlas {token}" });
        edited.EnsureSuccessStatusCode();
        Assert.DoesNotContain(messageId, await SearchIdsAsync($"zolw {token}"));
        Assert.Contains(messageId, await SearchIdsAsync($"atlas {token}"));

        var deleted = await _client.DeleteAsync($"/api/messages/{messageId}");
        deleted.EnsureSuccessStatusCode();
        Assert.DoesNotContain(messageId, await SearchIdsAsync($"atlas {token}"));
    }

    [Fact]
    public async Task IndexIncludesAttachmentNamesAndLinkMetadataAcrossTheWholeChannel()
    {
        await LoginAsync();
        var token = Guid.NewGuid().ToString("N")[..8];
        var messageId = Guid.NewGuid();
        var attachmentId = Guid.NewGuid();

        await using (var scope = _factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var authorId = await db.Users.Where(x => x.Username == "maja")
                .Select(x => x.Id)
                .SingleAsync();
            var attachment = new ImageAttachment
            {
                Id = attachmentId,
                UploadedById = authorId,
                ObjectKey = $"tests/{attachmentId:N}.pdf",
                FileName = $"raport-{token}.pdf",
                ContentType = "application/pdf",
                SizeBytes = 42,
                CreatedAt = DateTime.UtcNow,
            };
            db.ImageAttachments.Add(attachment);
            db.Messages.Add(new Message
            {
                Id = messageId,
                ChannelId = TestData.GeneralChannelId,
                AuthorId = authorId,
                Content = $"Materiały: https://archive.example/{token}",
                CreatedAt = DateTime.UtcNow.AddDays(-30),
                Attachments =
                [
                    new MessageAttachment
                    {
                        AttachmentId = attachmentId,
                        Attachment = attachment,
                    },
                ],
                Embeds =
                [
                    new MessageEmbed
                    {
                        Id = Guid.NewGuid(),
                        Url = $"https://archive.example/{token}",
                        Kind = EmbedKind.Link,
                        Provider = "archive",
                        Domain = "archive.example",
                        Title = $"Katalog projektu {token}",
                        Description = "Kompletna dokumentacja",
                        Position = 0,
                        CreatedAt = DateTime.UtcNow,
                    },
                ],
            });
            await db.SaveChangesAsync();
        }

        Assert.Contains(messageId.ToString(), await SearchIdsAsync($"raport {token}"));
        Assert.Contains(messageId.ToString(), await SearchIdsAsync($"dokumentacja {token}"));

        var media = await _client.GetFromJsonAsync<JsonElement>(
            $"/api/channels/{TestData.GeneralChannelId}/messages/index?kind=media&limit=10");
        Assert.Contains(
            messageId.ToString(),
            media.GetProperty("messages").EnumerateArray()
                .Select(item => item.GetProperty("id").GetString()));

        var links = await _client.GetFromJsonAsync<JsonElement>(
            $"/api/channels/{TestData.GeneralChannelId}/messages/index?kind=links&limit=10");
        Assert.Contains(
            messageId.ToString(),
            links.GetProperty("messages").EnumerateArray()
                .Select(item => item.GetProperty("id").GetString()));
    }

    private async Task LoginAsync()
    {
        var response = await _client.PostAsJsonAsync(
            "/api/auth/login",
            new { username = "maja", password = "Aurora!2026" });
        response.EnsureSuccessStatusCode();
    }

    private async Task<string?[]> SearchIdsAsync(string query)
    {
        var response = await _client.GetFromJsonAsync<JsonElement>(
            $"/api/channels/{TestData.GeneralChannelId}/messages/search?query={Uri.EscapeDataString(query)}");
        return response.EnumerateArray()
            .Select(item => item.GetProperty("id").GetString())
            .ToArray();
    }
}
