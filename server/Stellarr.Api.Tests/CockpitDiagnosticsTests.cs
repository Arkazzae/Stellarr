using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Stellarr.Api.Logging;
using Stellarr.Api.Realtime;

namespace Stellarr.Api.Tests;

public sealed partial class CockpitDiagnosticsTests : IClassFixture<StellarrWebApplicationFactory>
{
    private const string Category = "CockpitDiagnosticsTests";

    private readonly StellarrWebApplicationFactory _factory;

    public CockpitDiagnosticsTests(StellarrWebApplicationFactory factory) => _factory = factory;

    [LoggerMessage(EventId = 1, Level = LogLevel.Warning, Message = "{Marker}")]
    private static partial void LogWarning(ILogger logger, string marker);

    [LoggerMessage(EventId = 2, Level = LogLevel.Debug, Message = "{Marker}")]
    private static partial void LogDebug(ILogger logger, string marker);

    [LoggerMessage(EventId = 3, Level = LogLevel.Error, Message = "{Marker}")]
    private static partial void LogError(ILogger logger, string marker);

    [LoggerMessage(EventId = 4, Level = LogLevel.Information, Message = "{Marker}")]
    private static partial void LogInformation(ILogger logger, string marker);

    [Theory]
    [InlineData("/api/cockpit/runtime")]
    [InlineData("/api/cockpit/logs")]
    [InlineData("/api/cockpit/logs/export")]
    public async Task OnlyTheInstanceOwnerReadsDiagnostics(string path)
    {
        using var anonymous = Client();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync(path)).StatusCode);

        using var member = Client();
        await LoginAsync(member, "jo", "Corona!2026");
        Assert.Equal(HttpStatusCode.Forbidden, (await member.GetAsync(path)).StatusCode);
    }

    [Fact]
    public async Task RuntimeReportsTheFiveCoreServices()
    {
        using var owner = await OwnerAsync();

        var runtime = await JsonAsync(await owner.GetAsync("/api/cockpit/runtime"));

        var services = runtime.GetProperty("services").EnumerateArray()
            .ToDictionary(
                service => service.GetProperty("name").GetString()!,
                service => service.GetProperty("state").GetString());
        Assert.Equal(
            ["API", "SQLite", "SignalR", "Maintenance worker", "Object storage"],
            services.Keys);
        Assert.Equal("healthy", services["API"]);
        Assert.Equal("healthy", services["SQLite"]);
        Assert.Equal("healthy", services["SignalR"]);
        // The test host switches both off in its configuration.
        Assert.Equal("inactive", services["Maintenance worker"]);
        Assert.Equal("inactive", services["Object storage"]);
        Assert.True(runtime.GetProperty("uptimeSeconds").GetInt64() >= 0);
        Assert.True(runtime.GetProperty("workingSetBytes").GetInt64() > 0);
        Assert.True(runtime.GetProperty("threadCount").GetInt32() > 0);
        Assert.True(runtime.GetProperty("databaseLatencyMs").GetDouble() >= 0);
    }

    [Fact]
    public async Task RuntimeCountsMemberConnectionsAndVoiceRooms()
    {
        using var factory = new StellarrWebApplicationFactory();
        var presence = factory.Services.GetRequiredService<PresenceTracker>();
        var memberId = Guid.Parse("30000000-0000-0000-0000-000000000002");
        presence.Connect("cockpit-runtime-connection", memberId);
        presence.JoinVoice("cockpit-runtime-connection", memberId, TestData.VoiceChannelId);
        using var owner = Client(factory);
        await LoginAsync(owner, "maja", "Aurora!2026");

        var runtime = await JsonAsync(await owner.GetAsync("/api/cockpit/runtime"));

        Assert.Equal(1, runtime.GetProperty("realtimeConnections").GetInt32());
        Assert.Equal(1, runtime.GetProperty("voiceRooms").GetInt32());
        var signalR = runtime.GetProperty("services").EnumerateArray()
            .Single(service => service.GetProperty("name").GetString() == "SignalR");
        Assert.Equal("1 aktywnych połączeń", signalR.GetProperty("detail").GetString());
    }

    [Fact]
    public async Task LogsReturnTheNewestLinesFirst()
    {
        using var owner = await OwnerAsync();
        var marker = $"marker-{Guid.NewGuid():N}";
        var logger = _factory.Services.GetRequiredService<ILoggerFactory>().CreateLogger(Category);
        string[] lines = [$"{marker}-first", $"{marker}-second", $"{marker}-debug"];
        LogWarning(logger, lines[0]);
        LogWarning(logger, lines[1]);
        LogDebug(logger, lines[2]);

        var logs = await JsonAsync(await owner.GetAsync($"/api/cockpit/logs?search={marker}&source={Category}"));

        var entries = logs.GetProperty("entries").EnumerateArray().ToArray();
        Assert.Equal([lines[1], lines[0]], entries.Select(entry => entry.GetProperty("message").GetString()));
        Assert.Equal("warn", entries[0].GetProperty("level").GetString());
        Assert.Equal(Category, entries[0].GetProperty("source").GetString());
        Assert.Equal("background", entries[0].GetProperty("traceId").GetString());
        Assert.True(entries[0].GetProperty("sequence").GetInt64() > entries[1].GetProperty("sequence").GetInt64());
        Assert.Equal(JsonValueKind.Null, logs.GetProperty("nextBefore").ValueKind);
        Assert.Equal(10_000, logs.GetProperty("capacity").GetInt32());
        Assert.False(logs.TryGetProperty("audit", out _));
    }

    [Fact]
    public async Task LogsArePagedOlderFromTheCursor()
    {
        using var owner = await OwnerAsync();
        var marker = $"page-{Guid.NewGuid():N}";
        var logger = _factory.Services.GetRequiredService<ILoggerFactory>().CreateLogger(Category);
        for (var number = 1; number <= 5; number++)
        {
            LogWarning(logger, $"{marker} {number}");
        }

        var seen = new List<string>();
        string? cursor = null;
        do
        {
            var page = await JsonAsync(await owner.GetAsync(
                $"/api/cockpit/logs?search={marker}&source={Category}&limit=2{(cursor is null ? "" : $"&before={cursor}")}"));
            seen.AddRange(page.GetProperty("entries").EnumerateArray().Select(entry => entry.GetProperty("message").GetString()!));
            var next = page.GetProperty("nextBefore");
            cursor = next.ValueKind == JsonValueKind.Null ? null : next.GetInt64().ToString(CultureInfo.InvariantCulture);
        }
        while (cursor is not null);

        Assert.Equal(Enumerable.Range(1, 5).Reverse().Select(number => $"{marker} {number}"), seen);
    }

    [Fact]
    public async Task LogsFilterByLevelSourceAndSearch()
    {
        using var owner = await OwnerAsync();
        var marker = $"Filter-{Guid.NewGuid():N}";
        var logger = _factory.Services.GetRequiredService<ILoggerFactory>().CreateLogger(Category);
        var other = _factory.Services.GetRequiredService<ILoggerFactory>().CreateLogger("Other.Source");
        LogWarning(logger, $"{marker} warned");
        var failed = $"{marker} failed";
        LogError(logger, failed);
        LogWarning(other, $"{marker} elsewhere");

        var errors = await JsonAsync(await owner.GetAsync($"/api/cockpit/logs?search={marker.ToUpperInvariant()}&level=error"));
        Assert.Equal([$"{marker} failed"], errors.GetProperty("entries").EnumerateArray().Select(x => x.GetProperty("message").GetString()));
        // The counts follow the search but not the chosen level.
        Assert.Equal(2, errors.GetProperty("levels").GetProperty("warn").GetInt32());
        Assert.Equal(1, errors.GetProperty("levels").GetProperty("error").GetInt32());

        var fromSource = await JsonAsync(await owner.GetAsync($"/api/cockpit/logs?search={marker}&source=Other.Source"));
        Assert.Equal([$"{marker} elsewhere"], fromSource.GetProperty("entries").EnumerateArray().Select(x => x.GetProperty("message").GetString()));
        Assert.Contains(fromSource.GetProperty("sources").EnumerateArray(), x => x.GetProperty("name").GetString() == "Other.Source");

        var both = await JsonAsync(await owner.GetAsync($"/api/cockpit/logs?search={marker}&level=warn,error,bogus"));
        Assert.Equal(3, both.GetProperty("entries").GetArrayLength());
    }

    [Fact]
    public async Task LogsHoldTheLimitBetweenOneAndFiveHundred()
    {
        using var owner = await OwnerAsync();
        var logger = _factory.Services.GetRequiredService<ILoggerFactory>().CreateLogger(Category);
        LogWarning(logger, "one");
        LogWarning(logger, "two");

        Assert.Single((await JsonAsync(await owner.GetAsync("/api/cockpit/logs?limit=1")))
            .GetProperty("entries").EnumerateArray());
        Assert.Single((await JsonAsync(await owner.GetAsync("/api/cockpit/logs?limit=-5")))
            .GetProperty("entries").EnumerateArray());
        Assert.True((await JsonAsync(await owner.GetAsync("/api/cockpit/logs?limit=1000000")))
            .GetProperty("entries").GetArrayLength() <= 500);
    }

    [Fact]
    public async Task ExportIsTabSeparatedWithOneLinePerEntryOldestFirst()
    {
        using var owner = await OwnerAsync();
        var marker = $"export-{Guid.NewGuid():N}";
        var logger = _factory.Services.GetRequiredService<ILoggerFactory>().CreateLogger(Category);
        string[] lines = [$"{marker}\tfirst\nline", $"{marker} second"];
        LogWarning(logger, lines[0]);
        LogWarning(logger, lines[1]);

        var response = await owner.GetAsync("/api/cockpit/logs/export");

        response.EnsureSuccessStatusCode();
        Assert.Equal("text/tab-separated-values", response.Content.Headers.ContentType?.MediaType);
        Assert.Matches(
            @"^stellarr-logs-\d{8}-\d{6}\.tsv$",
            response.Content.Headers.ContentDisposition?.FileName?.Trim('"'));
        var rows = (await response.Content.ReadAsStringAsync()).Split('\n', StringSplitOptions.RemoveEmptyEntries);
        Assert.Equal("at\tlevel\tsource\ttrace\tmessage", rows[0]);
        Assert.All(rows, row => Assert.Equal(5, row.Split('\t').Length));
        var first = Array.FindIndex(rows, row => row.EndsWith($"{marker} first line", StringComparison.Ordinal));
        var second = Array.FindIndex(rows, row => row.EndsWith($"{marker} second", StringComparison.Ordinal));
        Assert.True(first > 0 && first < second, "the older line comes first");
        Assert.StartsWith("warn\t" + Category + "\tbackground\t", rows[first][(rows[first].IndexOf('\t') + 1)..]);
    }

    [Fact]
    public async Task ExportKeepsOnlyTheLinesTheFiltersKeep()
    {
        using var owner = await OwnerAsync();
        var marker = $"exported-{Guid.NewGuid():N}";
        var logger = _factory.Services.GetRequiredService<ILoggerFactory>().CreateLogger(Category);
        LogWarning(logger, $"{marker} kept");
        var dropped = $"{marker} dropped";
        LogInformation(logger, dropped);

        var text = await (await owner.GetAsync($"/api/cockpit/logs/export?search={marker}&level=warn")).Content.ReadAsStringAsync();

        Assert.Contains($"{marker} kept", text, StringComparison.Ordinal);
        Assert.DoesNotContain($"{marker} dropped", text, StringComparison.Ordinal);
    }

    [Fact]
    public void BufferKeepsOnlyTheNewestLinesOnceFull()
    {
        var buffer = new CockpitLogBuffer(new HttpContextAccessor());
        var logger = buffer.CreateLogger(Category);
        var messages = Enumerable.Range(1, CockpitLogBuffer.Capacity + 100).Select(number => $"line {number}").ToArray();
        foreach (var message in messages)
        {
            LogWarning(logger, message);
        }

        var lines = buffer.Snapshot(int.MaxValue);

        Assert.Equal(CockpitLogBuffer.Capacity, lines.Count);
        Assert.Equal($"line {CockpitLogBuffer.Capacity + 100}", lines[0].Message);
        Assert.Equal("line 101", lines[^1].Message);
        Assert.Single(buffer.Snapshot(0));
    }

    [Fact]
    public void BufferPagesFromTheCursorAndSaysWhetherMoreRemain()
    {
        var buffer = new CockpitLogBuffer(new HttpContextAccessor());
        var logger = buffer.CreateLogger(Category);
        for (var number = 1; number <= 6; number++)
        {
            LogWarning(logger, $"line {number}");
        }

        var even = buffer.Page(null, 2, line => line.Message.EndsWith('2') || line.Message.EndsWith('4') || line.Message.EndsWith('6'));
        Assert.Equal(["line 6", "line 4"], even.Lines.Select(line => line.Message));
        Assert.True(even.HasMore);
        var rest = buffer.Page(even.Lines[^1].Sequence, 2, line => line.Message.EndsWith('2') || line.Message.EndsWith('4') || line.Message.EndsWith('6'));
        Assert.Equal(["line 2"], rest.Lines.Select(line => line.Message));
        Assert.False(rest.HasMore);
        Assert.Equal(5, buffer.Page(null, 10, _ => true).Lines[0].Sequence);
    }

    [Fact]
    public void BufferRecordsExceptionsAndTheTraceOfTheRequestBeingServed()
    {
        var buffer = new CockpitLogBuffer(new HttpContextAccessor
        {
            HttpContext = new DefaultHttpContext { TraceIdentifier = "trace-7" },
        });
        var logger = buffer.CreateLogger(Category);

        logger.Log(
            LogLevel.Error,
            new EventId(3),
            "upload failed",
            new InvalidOperationException("disk full"),
            (state, _) => state);
        LogDebug(logger, "too quiet to keep");

        var line = Assert.Single(buffer.Snapshot(10));
        Assert.Equal("upload failed — InvalidOperationException: disk full", line.Message);
        Assert.Equal(LogLevel.Error, line.Level);
        Assert.Equal("trace-7", line.TraceId);
    }

    private static async Task<string> MemberRoleIdAsync(HttpClient owner)
    {
        var users = await JsonAsync(await owner.GetAsync("/api/cockpit/users"));
        return users.GetProperty("roles").EnumerateArray()
            .Single(role => role.GetProperty("isSystem").GetBoolean() && !role.GetProperty("isOwner").GetBoolean())
            .GetProperty("id").GetString()!;
    }

    private async Task<HttpClient> OwnerAsync()
    {
        var client = Client();
        await LoginAsync(client, "maja", "Aurora!2026");
        return client;
    }

    [Fact]
    public async Task RuntimeCarriesTheProcessHistoryOfTheLastHour()
    {
        using var owner = Client();
        await LoginAsync(owner, "maja", "Aurora!2026");

        var runtime = await JsonAsync(await owner.GetAsync("/api/cockpit/runtime"));

        Assert.Equal(30, runtime.GetProperty("sampleSeconds").GetInt32());
        Assert.InRange(runtime.GetProperty("cpuPercent").GetDouble(), 0, 100);
        // The sampler takes its first sample as the host starts.
        var history = runtime.GetProperty("history").EnumerateArray().ToArray();
        Assert.NotEmpty(history);
        Assert.True(history[^1].GetProperty("workingSetBytes").GetInt64() > 0);
        Assert.True(history[^1].GetProperty("requests").GetInt32() >= 0);
    }

    private HttpClient Client() => Client(_factory);

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
