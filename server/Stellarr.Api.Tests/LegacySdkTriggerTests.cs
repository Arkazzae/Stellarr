using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Stellarr.Api.Data;

namespace Stellarr.Api.Tests;

/// <summary>
/// Databases written by earlier builds carry triggers that copied every
/// message and reaction into a table of domain events. The upgrade removes
/// them, because nothing reads that table or prunes it any more.
/// </summary>
public sealed class LegacySdkTriggerTests
{
    private static readonly (string Name, string Table, string Event)[] RetiredTriggers =
    [
        ("Messages_SdkDomainEvents_AfterInsert", "Messages", "INSERT"),
        ("Messages_SdkDomainEvents_AfterUpdate", "Messages", "UPDATE"),
        ("Messages_SdkDomainEvents_AfterDelete", "Messages", "DELETE"),
        ("MessageReactions_SdkDomainEvents_AfterInsert", "MessageReactions", "INSERT"),
        ("MessageReactions_SdkDomainEvents_AfterDelete", "MessageReactions", "DELETE"),
    ];

    [Fact]
    public async Task UpgradeRemovesTheRetiredTriggersAndKeepsTheJournalOnes()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true });
        (await client.PostAsJsonAsync("/api/auth/login", new { username = "ada", password = "Quasar!2026" }))
            .EnsureSuccessStatusCode();
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await db.Database.ExecuteSqlRawAsync(
            """CREATE TABLE "LegacyDomainEvents" ("Topic" TEXT NOT NULL);""");
        foreach (var (name, table, trigger) in RetiredTriggers)
        {
            var statement = $"""
                CREATE TRIGGER "{name}" AFTER {trigger} ON "{table}"
                BEGIN
                    INSERT INTO "LegacyDomainEvents" ("Topic") VALUES ('{name}');
                END;
                """;
            await db.Database.ExecuteSqlRawAsync(statement);
        }

        await PostMessageAsync(client, "przed aktualizacją");
        Assert.Equal(1, await CountLegacyEventsAsync(db));

        await DatabaseSchema.UpgradeAsync(db, default);

        var triggers = await db.Database
            .SqlQueryRaw<string>("""SELECT name AS Value FROM sqlite_master WHERE type = 'trigger'""")
            .ToArrayAsync();
        Assert.All(RetiredTriggers, retired => Assert.DoesNotContain(retired.Name, triggers));
        Assert.Contains("Messages_Changes_AfterInsert", triggers);
        await PostMessageAsync(client, "po aktualizacji");
        Assert.Equal(1, await CountLegacyEventsAsync(db));
    }

    private static async Task PostMessageAsync(HttpClient client, string content)
    {
        var response = await client.PostAsJsonAsync(
            $"/api/channels/{TestData.GeneralChannelId}/messages",
            new { content });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    private static Task<int> CountLegacyEventsAsync(AppDbContext db) =>
        db.Database.SqlQueryRaw<int>("""SELECT COUNT(*) AS Value FROM "LegacyDomainEvents" """).SingleAsync();
}
