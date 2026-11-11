using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Stellarr.Api.Data;
using Stellarr.Api.Mail;
using Stellarr.Api.Storage;

namespace Stellarr.Api.Tests;

public sealed class StellarrWebApplicationFactory : WebApplicationFactory<Program>
{
    private readonly bool _loadTestData;
    private readonly IReadOnlyDictionary<string, string?> _configuration;
    private readonly string _databasePath;
    private readonly string _dataRoot;
    private readonly bool _deleteStorageOnDispose;
    private readonly Action<IServiceCollection>? _configureServices;
    internal FakeEmailDelivery EmailDelivery { get; } = new();
    internal string DataRoot => _dataRoot;

    public StellarrWebApplicationFactory() : this(loadTestData: true) { }

    internal StellarrWebApplicationFactory(
        bool loadTestData,
        IReadOnlyDictionary<string, string?>? configuration = null,
        string? databasePath = null,
        string? dataRoot = null,
        bool deleteStorageOnDispose = true,
        Action<IServiceCollection>? configureServices = null)
    {
        _loadTestData = loadTestData;
        _configuration = configuration ?? new Dictionary<string, string?>();
        _databasePath = databasePath ?? Path.Combine(
            Path.GetTempPath(),
            $"stellarr-tests-{Guid.NewGuid():N}.db");
        _dataRoot = dataRoot ?? Path.Combine(
            Path.GetTempPath(),
            $"stellarr-data-{Guid.NewGuid():N}");
        _deleteStorageOnDispose = deleteStorageOnDispose;
        _configureServices = configureServices;
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.ConfigureAppConfiguration((_, configuration) =>
        {
            configuration.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Storage:SkipInitialization"] = "true",
                ["Maintenance:Enabled"] = "false",
                ["DataRoot"] = _dataRoot,
                ["Rtc:TurnPort"] = "3480",
                ["Rtc:TurnsPort"] = "5350",
                ["Rtc:TurnTcpEnabled"] = "true",
                ["Rtc:TurnsEnabled"] = "true",
                // The in-memory media server below answers every call. An
                // address that never resolves keeps anything that slipped
                // past it away from a real media server on this machine.
                ["Rtc:MediaControlUrl"] = "http://media.invalid/",
                ["Rtc:MediaControlSecret"] = FakeMediaServer.Secret,
                ["Mail:Enabled"] = "true",
                ["Mail:ResendApiKey"] = "re_test",
                ["Mail:FromAddress"] = "onboarding@resend.dev",
                ["Operations:PublicUrl"] = "https://chat.test",
            });
            configuration.AddInMemoryCollection(_configuration);
        });
        builder.ConfigureServices(services =>
        {
            services.RemoveAll<DbContextOptions<AppDbContext>>();
            services.RemoveAll<AppDbContext>();
            services.AddDbContext<AppDbContext>(options => options.UseSqlite($"Data Source={_databasePath}"));
            services.RemoveAll<IObjectStorage>();
            services.AddSingleton<IObjectStorage, FakeObjectStorage>();
            services.RemoveAll<IEmailDelivery>();
            services.AddSingleton<IEmailDelivery>(EmailDelivery);
            if (_loadTestData)
            {
                services.AddHostedService<TestDataHostedService>();
            }
            // Every instance follows its media server from the start, so every
            // host gets one of its own, in memory. Its long poll waits as long
            // as the API's does, which keeps an idle host quiet. A test that
            // installs its own fake in configureServices registers it later,
            // and the later registration wins.
            new FakeMediaServer { EventWaitMs = 25_000 }.Install(services);
            _configureServices?.Invoke(services);
        });
    }

    /// <summary>
    /// Every client this factory hands out speaks as the browser build.
    ///
    /// The instance only serves clients that identify themselves — see
    /// `ClientGate` — and a test is exercising one of them, not an anonymous
    /// caller. The gate's own refusals are tested by sending something else.
    /// </summary>
    protected override void ConfigureClient(HttpClient client)
    {
        base.ConfigureClient(client);
        client.DefaultRequestHeaders.TryAddWithoutValidation("X-Stellarr-Client", "web");
        client.DefaultRequestHeaders.TryAddWithoutValidation(
            "X-Stellarr-Client-Version",
            "2.0.0");
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        if (disposing && _deleteStorageOnDispose)
        {
            // Pooled connections keep the database open, and deleting it under them strands
            // its write-ahead files in the temp directory: about 8 MB for every factory.
            // Only this factory's pool is cleared; other hosts run in parallel.
            using (var connection = new Microsoft.Data.Sqlite.SqliteConnection($"Data Source={_databasePath}"))
            {
                Microsoft.Data.Sqlite.SqliteConnection.ClearPool(connection);
            }

            foreach (var path in new[] { _databasePath, _databasePath + "-wal", _databasePath + "-shm" })
            {
                if (File.Exists(path))
                {
                    File.Delete(path);
                }
            }
        }
        if (disposing && _deleteStorageOnDispose && Directory.Exists(_dataRoot))
        {
            Directory.Delete(_dataRoot, recursive: true);
        }
    }
}

internal sealed class FakeEmailDelivery : IEmailDelivery
{
    private readonly List<(EmailMessage Message, MailTransport Transport)> _sent = [];
    internal Exception? Failure { get; set; }

    public IReadOnlyList<EmailMessage> Messages
    {
        get
        {
            lock (_sent) return _sent.Select(x => x.Message).ToArray();
        }
    }

    /// <summary>The transport each message was sent through, in the same order.</summary>
    public IReadOnlyList<MailTransport> Transports
    {
        get
        {
            lock (_sent) return _sent.Select(x => x.Transport).ToArray();
        }
    }

    public Task<string> SendAsync(EmailMessage message, MailTransport transport, CancellationToken cancellationToken)
    {
        if (Failure is { } failure) return Task.FromException<string>(failure);
        lock (_sent) _sent.Add((message, transport));
        return Task.FromResult($"email-{Messages.Count}");
    }
}

internal sealed class FakeObjectStorage : IObjectStorage
{
    private readonly Dictionary<string, (byte[] Bytes, string ContentType)> _objects = new(StringComparer.Ordinal);
    internal bool RejectDeletes { get; set; }

    public Task EnsureBucketAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    public async Task PutAsync(string key, Stream data, string contentType, CancellationToken cancellationToken)
    {
        await using var output = new MemoryStream();
        await data.CopyToAsync(output, cancellationToken);
        _objects[key] = (output.ToArray(), contentType);
    }

    public Task<StoredObject> GetAsync(string key, ByteRange? range, CancellationToken cancellationToken)
    {
        var stored = _objects[key];
        var total = stored.Bytes.LongLength;

        if (range is not { } wanted)
        {
            return Task.FromResult(new StoredObject(
                new MemoryStream(stored.Bytes), stored.ContentType, total, total, null));
        }

        // Mirrors the storage backend: inclusive at both ends, clamped to the
        // object, and the caller is told which slice it actually got.
        var from = Math.Min(wanted.From, total);
        var to = Math.Min(wanted.To ?? total - 1, total - 1);
        var length = Math.Max(0, to - from + 1);
        var slice = new MemoryStream(stored.Bytes, (int)from, (int)length);

        return Task.FromResult(new StoredObject(
            slice, stored.ContentType, length, total, new ByteRange(from, to)));
    }

    public Task DeleteAsync(string key, CancellationToken cancellationToken)
    {
        if (RejectDeletes)
        {
            throw new InvalidOperationException("Storage deletion rejected by test.");
        }
        _objects.Remove(key);
        return Task.CompletedTask;
    }

    public async IAsyncEnumerable<StoredObjectInfo> ListAsync(
        [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken cancellationToken)
    {
        // A snapshot, so a test may change the store while a listing runs.
        foreach (var (key, stored) in _objects.OrderBy(x => x.Key, StringComparer.Ordinal).ToArray())
        {
            cancellationToken.ThrowIfCancellationRequested();
            yield return new StoredObjectInfo(key, stored.Bytes.LongLength);
            await Task.Yield();
        }
    }

    /// <summary>When set, the probe Cockpit's availability bars take fails, as an unreachable store would.</summary>
    internal bool Unreachable { get; set; }

    public Task ProbeAsync(CancellationToken cancellationToken) =>
        Unreachable ? throw new IOException("The store does not answer.") : Task.CompletedTask;

    internal bool Contains(string key) => _objects.ContainsKey(key);
    internal int Count => _objects.Count;
}
