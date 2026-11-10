using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Stellarr.Api.Data;

namespace Stellarr.Api.Tests;

public sealed class ModerationSchemaTests
{
    private static readonly Guid JoId = Guid.Parse("30000000-0000-0000-0000-000000000005");

    [Fact]
    public async Task BansWorkOnADatabaseThatPredatesThem()
    {
        using var factory = new StellarrWebApplicationFactory();
        await using (var scope = factory.OpenScope(out var db))
        {
            await db.Database.ExecuteSqlRawAsync("""DROP TABLE "ServerBans";""");
            await DatabaseSchema.UpgradeAsync(db, CancellationToken.None);
            await DatabaseSchema.UpgradeAsync(db, CancellationToken.None);

            var indexes = await db.Database
                .SqlQuery<string>($"""SELECT "name" AS "Value" FROM pragma_index_list('ServerBans')""")
                .ToListAsync();
            Assert.Contains("IX_ServerBans_ServerId_BannedAt", indexes);
            Assert.Contains("IX_ServerBans_BannedById", indexes);
        }

        using var owner = await SignedInOwnerAsync(factory);
        var banned = await owner.PostAsJsonAsync($"/api/admin/members/{JoId}/ban", new { reason = "spam" });
        Assert.Equal(HttpStatusCode.Created, banned.StatusCode);
        Assert.Equal(1, (await owner.GetFromJsonAsync<JsonElement>("/api/admin/bans")).GetArrayLength());
    }

    [Fact]
    public async Task UpgradingKeepsTheBansAlreadyRecorded()
    {
        using var factory = new StellarrWebApplicationFactory();
        using (var owner = await SignedInOwnerAsync(factory))
        {
            (await owner.PostAsJsonAsync($"/api/admin/members/{JoId}/ban", new { reason = "spam" }))
                .EnsureSuccessStatusCode();
        }

        await using var scope = factory.OpenScope(out var db);
        await DatabaseSchema.UpgradeAsync(db, CancellationToken.None);

        var ban = await db.ServerBans.SingleAsync();
        Assert.Equal(JoId, ban.UserId);
        Assert.Equal("spam", ban.Reason);
    }

    private static async Task<HttpClient> SignedInOwnerAsync(StellarrWebApplicationFactory factory)
    {
        var client = factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            HandleCookies = true,
        });
        (await client.PostAsJsonAsync("/api/auth/login", new { username = "maja", password = "Aurora!2026" }))
            .EnsureSuccessStatusCode();
        return client;
    }
}
