using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;
using Stellarr.Api.Storage;

namespace Stellarr.Api.Tests;

public sealed class AttachmentAccessFlowTests : IClassFixture<StellarrWebApplicationFactory>
{
    private static readonly Guid MajaId = Guid.Parse("30000000-0000-0000-0000-000000000001");
    private static readonly Guid AdaId = Guid.Parse("30000000-0000-0000-0000-000000000002");
    private static readonly Guid JoId = Guid.Parse("30000000-0000-0000-0000-000000000005");
    private static readonly byte[] Bytes = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    private readonly StellarrWebApplicationFactory _factory;

    public AttachmentAccessFlowTests(StellarrWebApplicationFactory factory) => _factory = factory;

    [Fact]
    public async Task ServerAttachmentIsVisibleOnlyToItsUploaderAndServerMembers()
    {
        using var maja = Client();
        using var ada = Client();
        using var jo = Client();
        await LoginAsync(maja, "maja", "Aurora!2026");
        await LoginAsync(ada, "ada", "Quasar!2026");
        await LoginAsync(jo, "jo", "Corona!2026");

        var created = await maja.PostAsJsonAsync("/api/servers", new
        {
            name = $"Attachment ACL {Guid.NewGuid():N}",
            description = "isolated",
            isPublic = true,
        });
        created.EnsureSuccessStatusCode();
        using var createdPayload = JsonDocument.Parse(await created.Content.ReadAsStringAsync());
        var serverId = Guid.Parse(createdPayload.RootElement.GetProperty("id").GetString()!);
        (await ada.PostAsync($"/api/servers/{serverId}/join", null)).EnsureSuccessStatusCode();

        var attachmentId = Guid.NewGuid();
        var objectKey = $"tests/{attachmentId:N}.png";
        await using (var scope = _factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var storage = scope.ServiceProvider.GetRequiredService<IObjectStorage>();
            var channelId = await db.Channels.Where(x => x.ServerId == serverId && x.Kind == ChannelKind.Text)
                .Select(x => x.Id).SingleAsync();
            var attachment = Attachment(attachmentId, MajaId, objectKey);
            db.ImageAttachments.Add(attachment);
            db.Messages.Add(new Message
            {
                Id = Guid.NewGuid(),
                ChannelId = channelId,
                AuthorId = MajaId,
                Content = "private attachment",
                CreatedAt = DateTime.UtcNow,
                Attachments = [new MessageAttachment { AttachmentId = attachmentId, Attachment = attachment }],
            });
            await db.SaveChangesAsync();
            await storage.PutAsync(objectKey, new MemoryStream(Bytes), "image/png", CancellationToken.None);
        }

        Assert.Equal(Bytes, await maja.GetByteArrayAsync($"/assets/{attachmentId}"));
        Assert.Equal(Bytes, await ada.GetByteArrayAsync($"/assets/{attachmentId}"));
        Assert.Equal(HttpStatusCode.NotFound, (await jo.GetAsync($"/assets/{attachmentId}")).StatusCode);
    }

    [Fact]
    public async Task DirectMessageAttachmentIsVisibleOnlyToConversationParticipants()
    {
        var attachmentId = Guid.NewGuid();
        var objectKey = $"tests/{attachmentId:N}.png";
        await using (var scope = _factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var storage = scope.ServiceProvider.GetRequiredService<IObjectStorage>();
            var conversation = new DirectConversation
            {
                Id = Guid.NewGuid(),
                UserAId = AdaId,
                UserBId = JoId,
                CreatedAt = DateTime.UtcNow,
            };
            var attachment = Attachment(attachmentId, AdaId, objectKey);
            db.DirectConversations.Add(conversation);
            db.ImageAttachments.Add(attachment);
            db.DirectMessages.Add(new DirectMessage
            {
                Id = Guid.NewGuid(),
                ConversationId = conversation.Id,
                AuthorId = AdaId,
                Content = "private direct attachment",
                CreatedAt = DateTime.UtcNow,
                Attachments =
                [
                    new DirectMessageAttachment
                    {
                        AttachmentId = attachmentId,
                        Attachment = attachment,
                    },
                ],
            });
            await db.SaveChangesAsync();
            await storage.PutAsync(objectKey, new MemoryStream(Bytes), "image/png", CancellationToken.None);
        }

        using var ada = Client();
        using var jo = Client();
        using var maja = Client();
        await LoginAsync(ada, "ada", "Quasar!2026");
        await LoginAsync(jo, "jo", "Corona!2026");
        await LoginAsync(maja, "maja", "Aurora!2026");

        Assert.Equal(Bytes, await ada.GetByteArrayAsync($"/assets/{attachmentId}"));
        Assert.Equal(Bytes, await jo.GetByteArrayAsync($"/assets/{attachmentId}"));
        Assert.Equal(HttpStatusCode.NotFound, (await maja.GetAsync($"/assets/{attachmentId}")).StatusCode);
    }

    private static ImageAttachment Attachment(Guid id, Guid uploaderId, string objectKey) => new()
    {
        Id = id,
        UploadedById = uploaderId,
        ObjectKey = objectKey,
        FileName = "private.png",
        ContentType = "image/png",
        SizeBytes = Bytes.Length,
        CreatedAt = DateTime.UtcNow,
    };

    private HttpClient Client() => _factory.CreateClient(
        new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            HandleCookies = true,
        });

    private static async Task LoginAsync(HttpClient client, string username, string password) =>
        (await client.PostAsJsonAsync("/api/auth/login", new { username, password }))
            .EnsureSuccessStatusCode();
}
