using System.Net;
using System.Net.Http.Json;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;
using Stellarr.Api.Embeds;
using Stellarr.Api.Storage;

namespace Stellarr.Api.Tests;

public sealed class LinkExtractorTests
{
    [Fact]
    public void FindsLinksInOrderAndDropsDuplicates()
    {
        var links = LinkExtractor.Extract(
            "zobacz https://example.org/a oraz https://example.org/b i znowu https://example.org/a",
            limit: 5);

        Assert.Equal(
            ["https://example.org/a", "https://example.org/b"],
            links.Select(x => x.ToString()));
    }

    [Theory]
    // Sentence punctuation belongs to the sentence.
    [InlineData("czytaj https://example.org/a.", "https://example.org/a")]
    [InlineData("czytaj https://example.org/a, potem", "https://example.org/a")]
    // A bracket opened inside the URL stays in it; one that was not, does not.
    [InlineData("(patrz https://example.org/a)", "https://example.org/a")]
    [InlineData("https://example.org/a_(b)", "https://example.org/a_(b)")]
    public void TrimsTrailingPunctuationTheSameWayTheClientDoes(string content, string expected)
    {
        var links = LinkExtractor.Extract(content, limit: 5);
        Assert.Equal(expected, Assert.Single(links).ToString());
    }

    [Fact]
    public void IgnoresSchemesThatAreNotHttp()
    {
        Assert.Empty(LinkExtractor.Extract("javascript:alert(1) file:///etc/passwd ftp://example.org", limit: 5));
    }

    [Fact]
    public void StopsAtTheLimit()
    {
        var links = LinkExtractor.Extract("https://a.example https://b.example https://c.example", limit: 2);
        Assert.Equal(2, links.Count);
    }
}

public sealed class VideoLinksTests
{
    [Theory]
    [InlineData("https://www.youtube.com/watch?v=aqz-KE-bpKQ", "aqz-KE-bpKQ")]
    [InlineData("https://youtu.be/jNQXAC9IVRw", "jNQXAC9IVRw")]
    [InlineData("https://m.youtube.com/watch?v=aqz-KE-bpKQ&feature=share", "aqz-KE-bpKQ")]
    [InlineData("https://www.youtube.com/shorts/aqz-KE-bpKQ", "aqz-KE-bpKQ")]
    [InlineData("https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ", "aqz-KE-bpKQ")]
    public void RecognisesYouTube(string url, string expectedId)
    {
        Assert.True(VideoLinks.TryParse(new Uri(url), out var link));
        Assert.Equal(VideoLinks.YouTube, link.Provider);
        Assert.Equal(expectedId, link.Id);
    }

    [Theory]
    [InlineData("https://vimeo.com/123456789", "123456789")]
    [InlineData("https://player.vimeo.com/video/123456789", "123456789")]
    public void RecognisesVimeo(string url, string expectedId)
    {
        Assert.True(VideoLinks.TryParse(new Uri(url), out var link));
        Assert.Equal(VideoLinks.Vimeo, link.Provider);
        Assert.Equal(expectedId, link.Id);
    }

    [Theory]
    [InlineData("https://www.youtube.com/watch?v=eRsGyueVLvQ&t=95s", 95)]
    [InlineData("https://www.youtube.com/watch?v=eRsGyueVLvQ&t=1h2m3s", 3723)]
    [InlineData("https://youtu.be/eRsGyueVLvQ#t=30", 30)]
    public void ReadsTheStartTimestamp(string url, int expected)
    {
        Assert.True(VideoLinks.TryParse(new Uri(url), out var link));
        Assert.Equal(expected, link.StartSeconds);
    }

    [Theory]
    // A host that merely contains the name is not the host.
    [InlineData("https://youtube.com.evil.example/watch?v=aqz-KE-bpKQ")]
    // An id that is not an id.
    [InlineData("https://www.youtube.com/watch?v=../../etc/passwd")]
    [InlineData("https://www.youtube.com/watch?v=short")]
    [InlineData("https://example.org/watch?v=aqz-KE-bpKQ")]
    public void RefusesAnythingElse(string url)
    {
        Assert.False(VideoLinks.TryParse(new Uri(url), out _));
    }
}

public sealed class GiphyLinksTests
{
    [Theory]
    [InlineData("https://giphy.com/gifs/reaction-happy-AbCd1234", "AbCd1234")]
    [InlineData("https://www.giphy.com/gifs/AbCd1234", "AbCd1234")]
    public void RecognisesCanonicalGifPages(string url, string expectedId)
    {
        Assert.True(GiphyLinks.TryParse(new Uri(url), out var id));
        Assert.Equal(expectedId, id);
    }

    [Theory]
    [InlineData("http://giphy.com/gifs/AbCd1234")]
    [InlineData("https://giphy.com/stickers/AbCd1234")]
    [InlineData("https://giphy.com.evil.example/gifs/AbCd1234")]
    [InlineData("https://media.giphy.com/media/AbCd1234/giphy.gif")]
    public void RefusesNonCanonicalOrUntrustedUrls(string url)
    {
        Assert.False(GiphyLinks.TryParse(new Uri(url), out _));
    }
}

public sealed class OpenGraphTests
{
    private static readonly Uri Page = new("https://example.org/article");

    [Fact]
    public void PrefersOpenGraphOverTheTitleTag()
    {
        var card = OpenGraph.Parse(
            """
            <html><head>
              <title>Fallback</title>
              <meta property="og:title" content="Prawdziwy tytuł">
              <meta property="og:description" content="Opis   ze  spacjami">
              <meta property="og:image" content="/media/cover.png">
            </head><body>…</body></html>
            """,
            Page);

        Assert.Equal("Prawdziwy tytuł", card.Title);
        Assert.Equal("Opis ze spacjami", card.Description);
        Assert.Equal("https://example.org/media/cover.png", card.ImageUrl);
    }

    [Fact]
    public void FallsBackToTheTitleTagAndMetaDescription()
    {
        var card = OpenGraph.Parse(
            """<html><head><title>Tytuł &amp; więcej</title><meta name="description" content="Opis"></head></html>""",
            Page);

        Assert.Equal("Tytuł & więcej", card.Title);
        Assert.Equal("Opis", card.Description);
        Assert.Null(card.ImageUrl);
    }

    [Fact]
    public void IgnoresMetadataThatIsOnlyInTheBody()
    {
        var card = OpenGraph.Parse(
            """
            <html><head><title>Prawdziwy</title></head>
            <body><meta property="og:title" content="Podstawiony"></body></html>
            """,
            Page);

        Assert.Equal("Prawdziwy", card.Title);
    }

    [Theory]
    [InlineData("javascript:alert(1)")]
    [InlineData("data:image/svg+xml,<svg onload='alert(1)'/>")]
    public void DropsImageUrlsThatAreNotHttp(string image)
    {
        var card = OpenGraph.Parse(
            $"""<html><head><meta property="og:title" content="X"><meta property="og:image" content="{image}"></head></html>""",
            Page);

        Assert.Null(card.ImageUrl);
    }

    [Fact]
    public void CapsRunawayValues()
    {
        var card = OpenGraph.Parse(
            $"""<html><head><meta property="og:title" content="{new string('a', 500)}"></head></html>""",
            Page);

        Assert.NotNull(card.Title);
        Assert.True(card.Title.Length <= 201, $"title was {card.Title.Length} characters");
    }
}

public sealed class YouTubeMetadataTests
{
    [Fact]
    public void KeepsOnlyRealProviderMetadataForTheExpectedVideo()
    {
        var card = YouTubeMetadataResolver.Parse(
            Encoding.UTF8.GetBytes(
                """
                {
                  "type": "video",
                  "provider_name": "YouTube",
                  "title": "Big Buck Bunny 60fps 4K &amp; extras",
                  "thumbnail_url": "https://i.ytimg.com/vi/aqz-KE-bpKQ/hqdefault.jpg",
                  "html": "<iframe src=\"https://www.youtube.com/embed/evil\"></iframe>"
                }
                """),
            "aqz-KE-bpKQ");

        Assert.NotNull(card);
        Assert.Equal("Big Buck Bunny 60fps 4K & extras", card.Title);
        Assert.Equal("https://i.ytimg.com/vi/aqz-KE-bpKQ/hqdefault.jpg", card.ImageUrl);
        Assert.Null(card.Description);
    }

    [Theory]
    [InlineData("Vimeo", "https://i.ytimg.com/vi/aqz-KE-bpKQ/hqdefault.jpg")]
    [InlineData("YouTube", "https://evil.example/vi/aqz-KE-bpKQ/hqdefault.jpg")]
    [InlineData("YouTube", "https://i.ytimg.com/vi/jNQXAC9IVRw/hqdefault.jpg")]
    public void DoesNotTrustAThumbnailOutsideTheValidatedProviderAndId(
        string provider,
        string thumbnail)
    {
        var card = YouTubeMetadataResolver.Parse(
            Encoding.UTF8.GetBytes(
                $$"""
                {
                  "type": "video",
                  "provider_name": "{{provider}}",
                  "thumbnail_url": "{{thumbnail}}"
                }
                """),
            "aqz-KE-bpKQ");

        Assert.Null(card);
    }
}

public sealed class PublicAddressTests
{
    [Theory]
    [InlineData("127.0.0.1")]
    [InlineData("10.1.2.3")]
    [InlineData("172.16.0.1")]
    [InlineData("172.31.255.255")]
    [InlineData("192.168.1.1")]
    // The address a cloud instance answers its own credentials on.
    [InlineData("169.254.169.254")]
    [InlineData("100.64.0.1")]
    [InlineData("0.0.0.0")]
    [InlineData("224.0.0.1")]
    [InlineData("255.255.255.255")]
    [InlineData("::1")]
    [InlineData("fe80::1")]
    [InlineData("fc00::1")]
    [InlineData("::ffff:127.0.0.1")]
    [InlineData("::ffff:10.0.0.1")]
    [InlineData("2001:db8::1")]
    public void RefusesEverythingInsideTheHouse(string address)
    {
        Assert.False(PublicAddress.IsPublic(IPAddress.Parse(address)));
    }

    [Theory]
    [InlineData("1.1.1.1")]
    [InlineData("93.184.216.34")]
    [InlineData("172.32.0.1")]
    [InlineData("192.167.1.1")]
    [InlineData("2606:4700:4700::1111")]
    public void AllowsTheOpenInternet(string address)
    {
        Assert.True(PublicAddress.IsPublic(IPAddress.Parse(address)));
    }
}

public sealed class EmbedBuilderLifecycleTests
{
    [Fact]
    public async Task ClearingEmbedsRemovesTheirUnreferencedCachedThumbnails()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var client = factory.CreateClient();
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var storage = scope.ServiceProvider.GetRequiredService<IObjectStorage>();
        var builder = scope.ServiceProvider.GetRequiredService<EmbedBuilder>();

        var authorId = await db.Users.Where(x => x.Username == "maja")
            .Select(x => x.Id)
            .SingleAsync();
        var messageId = Guid.NewGuid();
        var attachmentId = Guid.NewGuid();
        var objectKey = $"embeds/tests/{attachmentId:N}.png";
        using (var content = new MemoryStream([1, 2, 3]))
        {
            await storage.PutAsync(objectKey, content, CancellationToken.None);
        }

        db.Messages.Add(new Message
        {
            Id = messageId,
            ChannelId = TestData.GeneralChannelId,
            AuthorId = authorId,
            Content = "wiadomość bez linku",
            CreatedAt = DateTime.UtcNow,
        });
        db.ImageAttachments.Add(new ImageAttachment
        {
            Id = attachmentId,
            UploadedById = Guid.Empty,
            ObjectKey = objectKey,
            FileName = "preview.png",
            ContentType = "image/png",
            SizeBytes = 3,
            CreatedAt = DateTime.UtcNow,
        });
        db.MessageEmbeds.Add(new MessageEmbed
        {
            Id = Guid.NewGuid(),
            MessageId = messageId,
            Url = "https://example.test/old",
            Provider = "example.test",
            Domain = "example.test",
            Title = "Stary podgląd",
            ThumbnailAttachmentId = attachmentId,
            Position = 0,
            CreatedAt = DateTime.UtcNow,
        });
        await db.SaveChangesAsync();

        Assert.Empty(await builder.BuildAsync(messageId, CancellationToken.None));
        Assert.False(await db.MessageEmbeds.AnyAsync(x => x.MessageId == messageId));
        Assert.False(await db.ImageAttachments.AnyAsync(x => x.Id == attachmentId));
        await Assert.ThrowsAsync<ObjectNotFoundException>(
            () => storage.GetAsync(objectKey, null, CancellationToken.None));
    }

    [Fact]
    public async Task DeletingMessageRemovesItsCachedThumbnails()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var client = factory.CreateClient();
        (await client.PostAsJsonAsync(
            "/api/auth/login",
            new { username = "maja", password = "Aurora!2026" })).EnsureSuccessStatusCode();

        var messageId = Guid.NewGuid();
        var attachmentId = Guid.NewGuid();
        var objectKey = $"embeds/tests/{attachmentId:N}.png";
        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var storage = scope.ServiceProvider.GetRequiredService<IObjectStorage>();
            var authorId = await db.Users.Where(x => x.Username == "maja")
                .Select(x => x.Id)
                .SingleAsync();
            using var content = new MemoryStream([1, 2, 3]);
            await storage.PutAsync(objectKey, content, CancellationToken.None);
            db.Messages.Add(new Message
            {
                Id = messageId,
                ChannelId = TestData.GeneralChannelId,
                AuthorId = authorId,
                Content = "https://example.test/old",
                CreatedAt = DateTime.UtcNow,
            });
            db.ImageAttachments.Add(new ImageAttachment
            {
                Id = attachmentId,
                UploadedById = Guid.Empty,
                ObjectKey = objectKey,
                FileName = "preview.png",
                ContentType = "image/png",
                SizeBytes = 3,
                CreatedAt = DateTime.UtcNow,
            });
            db.MessageEmbeds.Add(new MessageEmbed
            {
                Id = Guid.NewGuid(),
                MessageId = messageId,
                Url = "https://example.test/old",
                Provider = "example.test",
                Domain = "example.test",
                ThumbnailAttachmentId = attachmentId,
                Position = 0,
                CreatedAt = DateTime.UtcNow,
            });
            await db.SaveChangesAsync();
        }

        Assert.Equal(HttpStatusCode.NoContent,
            (await client.DeleteAsync($"/api/messages/{messageId}")).StatusCode);

        await using var verificationScope = factory.Services.CreateAsyncScope();
        var verificationDb = verificationScope.ServiceProvider.GetRequiredService<AppDbContext>();
        var verificationStorage = verificationScope.ServiceProvider.GetRequiredService<IObjectStorage>();
        Assert.False(await verificationDb.ImageAttachments.AnyAsync(x => x.Id == attachmentId));
        await Assert.ThrowsAsync<ObjectNotFoundException>(
            () => verificationStorage.GetAsync(objectKey, null, CancellationToken.None));
    }
}
