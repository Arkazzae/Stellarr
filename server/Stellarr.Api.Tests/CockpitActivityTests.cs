using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Stellarr.Api.Endpoints;

namespace Stellarr.Api.Tests;

public sealed class CockpitActivityTests
{
    private static readonly TimeZoneInfo Warsaw = TimeZoneInfo.FindSystemTimeZoneById("Europe/Warsaw");

    [Fact]
    public void InstantsCountOnTheirLocalDay()
    {
        var firstDay = new DateOnly(2026, 11, 9);
        DateTime[] instants =
        [
            // 23:30 UTC on the 10th is 00:30 on the 11th in Warsaw (UTC+1 in November).
            new(2026, 11, 10, 23, 30, 0, DateTimeKind.Utc),
            // 22:59 UTC on the 10th is still the 10th there.
            new(2026, 11, 10, 22, 59, 0, DateTimeKind.Utc),
            new(2026, 11, 9, 0, 0, 0, DateTimeKind.Utc),
            // SQLite returns timestamps without a kind; they are UTC all the same.
            new(2026, 11, 11, 12, 0, 0, DateTimeKind.Unspecified),
        ];

        var counts = CockpitEndpoints.CountByLocalDay(instants, firstDay, 3, Warsaw);

        Assert.Equal([1, 1, 2], counts);
    }

    [Fact]
    public void InstantsOutsideTheWindowAreNotCounted()
    {
        var firstDay = new DateOnly(2026, 11, 9);
        DateTime[] instants =
        [
            // 22:30 UTC on the 8th is 23:30 on the 8th in Warsaw: the day before the window.
            new(2026, 11, 8, 22, 30, 0, DateTimeKind.Utc),
            // 23:30 UTC on the 11th is the 12th in Warsaw: the day after it.
            new(2026, 11, 11, 23, 30, 0, DateTimeKind.Utc),
        ];

        Assert.Equal([0, 0, 0], CockpitEndpoints.CountByLocalDay(instants, firstDay, 3, Warsaw));
        Assert.Equal([0, 0, 1], CockpitEndpoints.CountByLocalDay(instants, firstDay, 3, TimeZoneInfo.Utc));
    }

    [Fact]
    public async Task OnlyTheInstanceOwnerReadsActivity()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var anonymous = Client(factory);
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync("/api/cockpit/activity")).StatusCode);

        using var member = Client(factory);
        await LoginAsync(member, "jo", "Corona!2026");
        Assert.Equal(HttpStatusCode.Forbidden, (await member.GetAsync("/api/cockpit/activity")).StatusCode);
    }

    [Fact]
    public async Task ThirtyDaysEndingTodayAddUpToTheOverview()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var owner = Client(factory);
        await LoginAsync(owner, "maja", "Aurora!2026");

        var activity = await JsonAsync(await owner.GetAsync("/api/cockpit/activity"));
        var overview = (await JsonAsync(await owner.GetAsync("/api/cockpit/bootstrap"))).GetProperty("overview");

        var days = activity.GetProperty("days").EnumerateArray().ToArray();
        Assert.Equal(CockpitEndpoints.ActivityDays, days.Length);
        var zone = TimeZoneInfo.FindSystemTimeZoneById(activity.GetProperty("timeZone").GetString()!);
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, zone));
        Assert.Equal(today.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), days[^1].GetProperty("date").GetString());
        Assert.Equal(today.AddDays(-29).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), days[0].GetProperty("date").GetString());
        // Every fixture message and membership is from this run, so all of them fall in the window.
        Assert.Equal(
            overview.GetProperty("messageCount").GetInt32(),
            days.Sum(day => day.GetProperty("messages").GetInt32()));
        Assert.Equal(
            overview.GetProperty("userCount").GetInt32(),
            days.Sum(day => day.GetProperty("newMembers").GetInt32()));
    }

    private static HttpClient Client(StellarrWebApplicationFactory factory) => factory.CreateClient(
        new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            HandleCookies = true,
        });

    private static async Task LoginAsync(HttpClient client, string username, string password) =>
        (await client.PostAsJsonAsync("/api/auth/login", new { username, password }))
            .EnsureSuccessStatusCode();

    private static async Task<JsonElement> JsonAsync(HttpResponseMessage response)
    {
        response.EnsureSuccessStatusCode();
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return document.RootElement.Clone();
    }
}
