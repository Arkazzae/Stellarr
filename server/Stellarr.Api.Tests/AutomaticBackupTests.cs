using System.Net.Http.Json;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Stellarr.Api.Backups;
using Stellarr.Api.Integrations.Cloudflare;
using Stellarr.Api.Storage;

namespace Stellarr.Api.Tests;

public sealed class AutomaticBackupTests
{
    [Fact]
    public async Task ExistingWorkerReadsPolicyChangesWithoutRestarting()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var owner = factory.CreateClient();
        (await owner.PostAsJsonAsync("/api/auth/login", new { username = "maja", password = "Aurora!2026" })).EnsureSuccessStatusCode();
        var policies = factory.Services.GetRequiredService<BackupPolicyStore>();
        var clock = new BackupClock();
        var destination = new RecordingDestination();
        using var worker = Create(factory, clock, destination, policies: policies);
        await worker.RunOnceAsync(default);
        Assert.Empty(destination.Paths);

        policies.Publish(new AutomaticBackupOptions { Enabled = true, IntervalHours = 24 });
        await worker.RunOnceAsync(default);
        Assert.Single(destination.Paths);
        clock.Advance(TimeSpan.FromHours(1));
        await worker.RunOnceAsync(default);
        Assert.Single(destination.Paths);

        policies.Publish(new AutomaticBackupOptions { Enabled = true, IntervalHours = 1 });
        await worker.RunOnceAsync(default);
        Assert.Equal(2, destination.Paths.Count);
        policies.Publish(new AutomaticBackupOptions { Enabled = false });
        clock.Advance(TimeSpan.FromDays(1));
        await worker.RunOnceAsync(default);
        Assert.Equal(2, destination.Paths.Count);
    }

    [Fact]
    public async Task IncompleteArchivesAreNotPublishedOrUploaded()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var owner = factory.CreateClient();
        (await owner.PostAsJsonAsync("/api/auth/login", new { username = "maja", password = "Aurora!2026" })).EnsureSuccessStatusCode();
        var storage = factory.Services.GetRequiredService<IObjectStorage>();
        using var content = new MemoryStream([1, 2, 3]);
        await storage.PutAsync("safe/object", content, default);
        content.Position = 0;
        // The archive deliberately skips unsafe keys and records them as missing.
        await storage.PutAsync("../unsafe", content, default);
        var destination = new RecordingDestination();
        using var worker = Create(factory, new BackupClock(), destination);

        await worker.RunOnceAsync(default);

        Assert.Null(worker.Status.LastSuccessAt);
        Assert.NotNull(worker.Status.LastError);
        Assert.Empty(destination.Paths);
        Assert.Empty(Directory.GetFiles(Path.Combine(factory.DataRoot, "backups")));
    }

    [Fact]
    public async Task FullBackupIsVerifiedAndDoesNotRunAgainBeforeTheInterval()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var owner = factory.CreateClient();
        (await owner.PostAsJsonAsync("/api/auth/login", new { username = "maja", password = "Aurora!2026" })).EnsureSuccessStatusCode();
        var clock = new BackupClock();
        var destination = new RecordingDestination();
        using var worker = Create(factory, clock, destination);

        await worker.RunOnceAsync(default);

        Assert.NotNull(worker.Status.LastSuccessAt);
        Assert.Null(worker.Status.LastError);
        var path = Assert.Single(destination.Paths);
        Assert.True(File.Exists(path + ".verified"));
        Assert.Equal("ok", await BackupArchive.VerifyAsync(path, Path.GetDirectoryName(path)!, default));
        Assert.Equal(BackupPartNames.Of(BackupParts.All), (await BackupArchive.ReadManifestAsync(path, default))!.Parts);
        await worker.RunOnceAsync(default);
        Assert.Single(destination.Paths);
        clock.Advance(TimeSpan.FromHours(24));
        await worker.RunOnceAsync(default);
        Assert.Equal(2, destination.Paths.Count);
    }

    [Fact]
    public async Task OffsiteFailureRetriesTheSameArchiveAfterRestart()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var owner = factory.CreateClient();
        (await owner.PostAsJsonAsync("/api/auth/login", new { username = "maja", password = "Aurora!2026" })).EnsureSuccessStatusCode();
        var clock = new BackupClock();
        var destination = new RecordingDestination { Fail = true };
        using (var worker = Create(factory, clock, destination))
        {
            await worker.RunOnceAsync(default);
            Assert.Null(worker.Status.LastSuccessAt);
            Assert.NotNull(worker.Status.PendingBackupId);
            Assert.NotNull(worker.Status.LastError);
            await worker.RunOnceAsync(default);
            Assert.Single(destination.Paths);
        }

        destination.Fail = false;
        clock.Advance(TimeSpan.FromMinutes(15));
        using var restarted = Create(factory, clock, destination);
        await restarted.StartAsync(default);
        // The hosted worker loads its checkpoint before the initial delay.
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        while (restarted.Status.PendingBackupId is null)
            await Task.Delay(10, timeout.Token);
        await restarted.RunOnceAsync(default);
        await restarted.StopAsync(default);

        Assert.NotNull(restarted.Status.LastSuccessAt);
        Assert.Null(restarted.Status.PendingBackupId);
        Assert.Null(restarted.Status.LastError);
        Assert.Equal(2, destination.Paths.Count);
        Assert.Equal(destination.Paths[0], destination.Paths[1]);
        Assert.Single(Directory.GetFiles(Path.Combine(factory.DataRoot, "backups"), "*.zip"));
    }

    [Fact]
    public async Task DisabledWorkerDoesNothing()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var client = factory.CreateClient();
        var destination = new RecordingDestination();
        using var worker = Create(factory, new BackupClock(), destination, enabled: false);
        await worker.RunOnceAsync(default);
        Assert.Empty(destination.Paths);
        Assert.Null(worker.Status.LastSuccessAt);
    }

    [Theory]
    [InlineData("http://example.com", "prefix", false)]
    [InlineData("https://example.com", "../escape", false)]
    [InlineData("https://example.com", "instance/backups", true)]
    public void DestinationRequiresHttpsAndSafePrefix(string endpoint, string prefix, bool valid)
    {
        Assert.Equal(valid, new CloudflareR2Options
        {
            Enabled = true, Endpoint = endpoint, Prefix = prefix,
            Bucket = "backup", AccessKey = "key", SecretKey = "secret",
        }.IsValid());
    }

    private static AutomaticBackupWorker Create(StellarrWebApplicationFactory factory, TimeProvider time,
        IBackupDestination destination, bool enabled = true, BackupPolicyStore? policies = null) => new(
        factory.Services.GetRequiredService<IServiceScopeFactory>(),
        factory.Services.GetRequiredService<IConfiguration>(),
        Options.Create(new AutomaticBackupOptions { Enabled = enabled, InitialDelayMinutes = 1440 }),
        factory.Services.GetRequiredService<BackupJobs>(), [destination], time,
        NullLogger<AutomaticBackupWorker>.Instance, policies);

    private sealed class BackupClock : TimeProvider
    {
        private DateTimeOffset _now = DateTimeOffset.UtcNow;
        public override DateTimeOffset GetUtcNow() => _now;
        public void Advance(TimeSpan amount) => _now += amount;
    }

    private sealed class RecordingDestination : IBackupDestination
    {
        public bool Enabled => true;
        public bool Fail { get; set; }
        public List<string> Paths { get; } = [];
        public Task UploadAsync(string path, Guid serverId, CancellationToken cancellationToken)
        {
            Paths.Add(path);
            if (Fail) throw new IOException("Simulated remote failure");
            return Task.CompletedTask;
        }
    }
}
