using Amazon.Runtime;
using Amazon.S3;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Stellarr.Api.Auth;
using Stellarr.Api.Auth.Security;
using Stellarr.Api.Backups;
using Stellarr.Api.Data;
using Stellarr.Api.Embeds;
using Stellarr.Api.Endpoints;
using Stellarr.Api.Integrations;
using Stellarr.Api.Integrations.Cloudflare;
using Stellarr.Api.Localization;
using Stellarr.Api.Logging;
using Stellarr.Api.Mail;
using Stellarr.Api.Maintenance;
using Stellarr.Api.Realtime;
using Stellarr.Api.Secrets;
using Stellarr.Api.Storage;

var builder = WebApplication.CreateBuilder(args);

// Without a secret of its own the relay would accept credentials that anyone
// can compute from the published development secret.
if (!builder.Environment.IsDevelopment() &&
    !builder.Environment.IsEnvironment("Testing") &&
    string.IsNullOrWhiteSpace(builder.Configuration["Rtc:TurnSharedSecret"]))
{
    throw new InvalidOperationException("Rtc:TurnSharedSecret is required outside development.");
}

var dataRoot = builder.Configuration["DataRoot"] ?? "data";
var keysDirectory = Directory.CreateDirectory(Path.Combine(dataRoot, "keys"));

// Kestrel's default request cap is below a useful video attachment. Each kind
// of upload still has a limit of its own, checked once the form is parsed; this
// is only the outer ceiling, form overhead included.
const long MaxRequestBodyBytes = 128 * 1024 * 1024;
builder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestBodySize = MaxRequestBodyBytes);
builder.Services.Configure<FormOptions>(options => options.MultipartBodyLengthLimit = MaxRequestBodyBytes);

builder.Services.AddProblemDetails();
// Bound and checked once the host starts, so that a language set by a test or
// by the environment is the one validated.
builder.Services.AddSingleton<IValidateOptions<LanguageOptions>, LanguageOptionsValidator>();
builder.Services.AddOptions<LanguageOptions>()
    .Bind(builder.Configuration.GetSection(LanguageOptions.SectionName))
    .ValidateOnStart();
builder.Services.AddSingleton(services => new Messages(services.GetRequiredService<IOptions<LanguageOptions>>().Value));
// The operator panel reads the host's recent log lines from this provider.
builder.Services.AddHttpContextAccessor();
builder.Services.AddSingleton<CockpitLogBuffer>();
builder.Services.AddSingleton<RuntimeMetrics>();
builder.Services.AddHostedService<RuntimeSampler>();
builder.Services.AddSingleton<ILoggerProvider>(services => services.GetRequiredService<CockpitLogBuffer>());
// The keys that protect the session cookie live on the data volume, so a
// restart or a new container does not sign everybody out.
builder.Services.AddDataProtection()
    .SetApplicationName("Stellarr")
    .PersistKeysToFileSystem(keysDirectory);

builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseSqlite(builder.Configuration.GetConnectionString("Database")));
builder.Services.AddSingleton<PasswordService>();
builder.Services.AddSingleton<PasskeyRelyingParty>();
builder.Services.AddSingleton<RegistrationGate>();
builder.Services.AddSingleton<ServerMutationGate>();
builder.Services.AddSingleton<PresenceTracker>();
builder.Services.AddSingleton<HubConnectionRegistry>();
builder.Services.AddScoped<SecurityNotificationDispatcher>();
builder.Services.AddHostedService<SecurityNotificationWorker>();
builder.Services.AddHostedService<SessionRevocationWatcher>();
builder.Services.AddSingleton<TurnCredentialService>();
AddMediaServer(builder.Services);
builder.Services.AddSingleton<SlowModeGate>();
builder.Services.AddSingleton<SoundboardPlaybackGate>();
builder.Services.AddSingleton<HubThrottleGate>();
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton(services => ClientDiscoveryIdentity.Load(services.GetRequiredService<IConfiguration>()));
builder.Services.AddSingleton<DesktopReleaseCatalogue>();
builder.Services.AddSingleton<AndroidReleaseCatalogue>();
builder.Services.AddSingleton<DesktopUpdateCatalogue>();
builder.Services.AddSignalR(options =>
{
    options.MaximumReceiveMessageSize = 160 * 1024;
    options.KeepAliveInterval = TimeSpan.FromSeconds(15);
    options.ClientTimeoutInterval = TimeSpan.FromSeconds(45);
});

builder.Services.Configure<StorageOptions>(builder.Configuration.GetSection(StorageOptions.SectionName));
builder.Services.AddSingleton<IAmazonS3>(services =>
{
    var options = services.GetRequiredService<IOptions<StorageOptions>>().Value;
    var config = new AmazonS3Config
    {
        ServiceURL = options.Endpoint,
        ForcePathStyle = true,
        AuthenticationRegion = "us-east-1",
    };
    return new AmazonS3Client(new BasicAWSCredentials(options.AccessKey, options.SecretKey), config);
});
builder.Services.AddSingleton<IObjectStorage, S3ObjectStorage>();
builder.Services.Configure<UploadOptions>(builder.Configuration.GetSection(UploadOptions.SectionName));
builder.Services.AddSingleton<UploadAdmissionGate>();
builder.Services.AddScoped<MediaStorage>();

builder.Services.Configure<MaintenanceOptions>(builder.Configuration.GetSection(MaintenanceOptions.SectionName));
builder.Services.AddScoped<InstanceMaintenance>();
builder.Services.AddHostedService<MaintenanceWorker>();

builder.Services.Configure<MailOptions>(builder.Configuration.GetSection(MailOptions.SectionName));
builder.Services.AddScoped<InstanceSecrets>();
builder.Services.AddSingleton<BackupJobs>();
builder.Services.AddOptions<AutomaticBackupOptions>()
    .Bind(builder.Configuration.GetSection(AutomaticBackupOptions.SectionName))
    .ValidateDataAnnotations()
    .ValidateOnStart();
builder.Services.AddOptions<CloudflareR2Options>()
    .Bind(builder.Configuration.GetSection(CloudflareR2Options.SectionName))
    .Validate(settings => settings.IsValid(requireCredentials: false),
        "Cloudflare R2 requires HTTPS, bucket, region and a safe prefix.")
    .ValidateOnStart();
builder.Services.AddSingleton<IBackupDestination, R2BackupDestination>();
builder.Services.AddSingleton<CloudflareR2PolicyStore>();
builder.Services.AddSingleton<BackupPolicyStore>();
builder.Services.AddSingleton<AutomaticBackupWorker>();
builder.Services.AddHostedService(services => services.GetRequiredService<AutomaticBackupWorker>());
builder.Services.AddSingleton<SmtpEmailDelivery>();
builder.Services.AddScoped<IEmailDelivery, MailDelivery>();
// GIPHY takes its key in the query string: this client logs nothing, so the
// key cannot reach the log Cockpit shows.
builder.Services.AddHttpClient<GiphyClient>(http =>
{
    http.BaseAddress = new Uri("https://api.giphy.com/");
    http.Timeout = TimeSpan.FromSeconds(10);
    http.DefaultRequestHeaders.UserAgent.ParseAdd("Stellarr/2.0");
    http.DefaultRequestHeaders.Accept.ParseAdd("application/json");
}).RemoveAllLoggers();
builder.Services.AddHttpClient<ResendEmailDelivery>(http =>
{
    http.BaseAddress = new Uri("https://api.resend.com/");
    http.Timeout = TimeSpan.FromSeconds(15);
    http.DefaultRequestHeaders.UserAgent.ParseAdd("Stellarr/2.0");
    http.DefaultRequestHeaders.Accept.ParseAdd("application/json");
});

builder.Services.Configure<EmbedOptions>(builder.Configuration.GetSection(EmbedOptions.SectionName));
builder.Services.AddSingleton<EmbedInbox>();
builder.Services.AddScoped<EmbedBuilder>();
builder.Services.AddHostedService<EmbedWorker>();
builder.Services
    .AddHttpClient<ILinkUnfurler, LinkUnfurler>(ConfigureEmbedClient(
        // Ask for a page and say so: a host that would rather not be previewed
        // can answer 406 instead of guessing what we want.
        "text/html,application/xhtml+xml,image/*;q=0.8",
        "pl,en;q=0.8"))
    .ConfigurePrimaryHttpMessageHandler(CreateEmbedHandler);
builder.Services
    .AddHttpClient<IYouTubeMetadataResolver, YouTubeMetadataResolver>(ConfigureEmbedClient("application/json"))
    .ConfigurePrimaryHttpMessageHandler(CreateEmbedHandler);

var externalOidc = builder.Configuration
    .GetSection(ExternalOidcOptions.SectionName)
    .Get<ExternalOidcOptions>() ?? new ExternalOidcOptions();
builder.Services.AddSingleton(externalOidc);
builder.Services
    .AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
    .AddSessionCookie(
        allowPlainHttp: builder.Environment.IsDevelopment() || builder.Environment.IsEnvironment("Testing"))
    .AddExternalOidc(externalOidc);
builder.Services.AddAuthorization();
builder.Services.AddRateLimitPolicies(builder.Configuration, builder.Environment);

// The instance runs behind a reverse proxy that the operator controls, so any
// sender of X-Forwarded-* is trusted rather than a fixed list of proxies.
builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders = ForwardedHeaders.XForwardedFor |
        ForwardedHeaders.XForwardedHost |
        ForwardedHeaders.XForwardedProto;
    options.KnownIPNetworks.Clear();
    options.KnownProxies.Clear();
});

if (builder.Environment.IsDevelopment())
{
    builder.Services.AddCors(options => options.AddDefaultPolicy(policy => policy
        .WithOrigins("http://localhost:3000", "http://127.0.0.1:3000")
        .AllowAnyHeader()
        .AllowAnyMethod()
        .AllowCredentials()));
}

var app = builder.Build();

// Read once before anything is served, so an unusable media server setting
// stops the API at start instead of at the first call that needs it. It is
// read from the built host because only there does it see every source of
// configuration.
app.Services.GetRequiredService<MediaServerSettings>();

// Outermost, so it counts the status the client gets, the exception handler's 500 included.
var runtimeMetrics = app.Services.GetRequiredService<RuntimeMetrics>();
app.Use(async (context, next) =>
{
    try
    {
        await next(context);
    }
    finally
    {
        runtimeMetrics.CountResponse(context.Response.StatusCode);
    }
});
app.UseExceptionHandler();
app.UseForwardedHeaders();
if (app.Environment.IsDevelopment())
{
    app.UseCors();
}
app.UseRateLimiter();
app.UseClientGate();
app.UseAuthentication();
app.UseAuthorization();
// Sets how often WebSocket connections, the hub's included, are pinged.
// Reverse proxies in front of existing installations rely on it to keep an
// idle connection open.
app.UseWebSockets(new WebSocketOptions { KeepAliveInterval = TimeSpan.FromSeconds(20) });

app.MapGet("/health/live", () => Results.Ok(new { status = "live" }));
app.MapGet("/health/ready", async (AppDbContext db, CancellationToken cancellationToken) =>
    await db.Database.CanConnectAsync(cancellationToken)
        ? Results.Ok(new { status = "ready" })
        : Results.Problem(statusCode: StatusCodes.Status503ServiceUnavailable, title: "Database unavailable"));

app.MapClientDiscoveryEndpoints();
app.MapDesktopReleaseEndpoints();
app.MapAndroidReleaseEndpoints();
app.MapDesktopUpdateEndpoints();
app.MapAuthEndpoints();
app.MapMfaEndpoints();
app.MapPasskeySignInEndpoints();
app.MapEmailChangeEndpoints();
app.MapCliRecoveryEndpoints();
app.MapPasswordRecoveryEndpoints();
app.MapRegistrationEndpoints();
app.MapDesktopBrowserLoginEndpoints();
app.MapSessionEndpoints();
app.MapAccountEndpoints();
app.MapAccountSecurityEndpoints();
app.MapProfileImageEndpoints();
app.MapBootstrapEndpoints();
app.MapUploadEndpoints();
app.MapAssetEndpoints();
app.MapMessageEndpoints();
app.MapMessageHistoryEndpoints();
app.MapMessageReactionEndpoints();
app.MapMessagePinEndpoints();
app.MapMessageThreadEndpoints();
app.MapMessageIndexEndpoints();
app.MapChannelReadEndpoints();
app.MapChannelEndpoints();
app.MapSectionEndpoints();
app.MapRoleEndpoints();
app.MapPermissionOverrideEndpoints();
app.MapServerDirectoryEndpoints();
app.MapServerEndpoints();
app.MapServerAdministrationEndpoints();
app.MapModerationEndpoints();
app.MapVoiceModerationEndpoints();
app.MapNotificationEndpoints();
app.MapSocialEndpoints();
app.MapDirectMessageEndpoints();
app.MapEmojiEndpoints();
app.MapSoundboardEndpoints();
app.MapCockpitEndpoints();
app.MapHub<AppHub>("/hubs/app");

await InitializeApplicationAsync(app);
await app.RunAsync();

// Runs before the host starts serving, so hosted services and requests only
// ever see a database and an object store that are ready.
static async Task InitializeApplicationAsync(WebApplication app)
{
    var stopping = app.Lifetime.ApplicationStopping;
    await using (var scope = app.Services.CreateAsyncScope())
    {
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await DatabaseSchema.UpgradeAsync(db, stopping);
        await app.Services.GetRequiredService<BackupPolicyStore>().LoadAsync(db, stopping);
        await app.Services.GetRequiredService<CloudflareR2PolicyStore>().LoadAsync(db, stopping);
        // A backup cut short by the last stop left a partial file; it is no backup.
        BackupJobs.RemoveLeftovers(BackupJobs.Directory(app.Configuration));
        await EmbedRecovery.EnqueueStaleYouTubeAsync(db, app.Services.GetRequiredService<EmbedInbox>(), stopping);
    }

    if (app.Configuration.GetValue<bool>("Storage:SkipInitialization"))
    {
        return;
    }

    // The object store usually starts next to this process and needs a moment.
    const int maxAttempts = 30;
    var storage = app.Services.GetRequiredService<IObjectStorage>();
    for (var attempt = 1; ; attempt++)
    {
        try
        {
            await storage.EnsureBucketAsync(stopping);
            return;
        }
        catch (Exception exception) when (attempt < maxAttempts && !stopping.IsCancellationRequested)
        {
            StartupLog.RustFsNotReady(app.Logger, attempt, maxAttempts, exception.Message);
            await Task.Delay(TimeSpan.FromSeconds(1), stopping);
        }
    }
}

// Stellarr Media, the selective forwarding unit every voice room goes through.
// The background services follow its events and close the sessions of seats
// that ended, from the moment the API starts.
static void AddMediaServer(IServiceCollection services)
{
    services.AddSingleton(provider => MediaServerSettings.Load(provider.GetRequiredService<IConfiguration>()));
    services.AddSingleton<MediaControlTiming>();
    services
        .AddHttpClient(MediaControlClient.HttpClientName, (provider, http) =>
        {
            http.BaseAddress = provider.GetRequiredService<MediaServerSettings>().ControlUrl;
            // Each call sets its own, shorter limit; this only catches one
            // that slipped past it.
            http.Timeout = TimeSpan.FromMinutes(1);
        })
        // The control API listens next to the API, never behind a proxy, and a
        // refused connection there means the media server is down, which is
        // worth knowing at once.
        .ConfigurePrimaryHttpMessageHandler(() => new SocketsHttpHandler
        {
            UseProxy = false,
            ConnectTimeout = TimeSpan.FromSeconds(2),
        })
        // The event poll alone would log four lines every 25 seconds, and a
        // media server that is down several each retry. The media code logs
        // the changes of state that matter itself.
        .RemoveAllLoggers();
    services.AddSingleton<MediaControlClient>();
    services.AddSingleton<MediaEventOutbox>();
    services.AddSingleton<MediaPlane>();
    services.AddSingleton<MediaSessionCloser>();
    services.AddSingleton<IMediaSessionCloser>(provider => provider.GetRequiredService<MediaSessionCloser>());
    services.AddHostedService(provider => provider.GetRequiredService<MediaSessionCloser>());
    services.AddHostedService<MediaEventPump>();
}

// Both clients that read other people's pages connect through the handler that
// refuses private addresses, and both give up after the same time.
static Action<IServiceProvider, HttpClient> ConfigureEmbedClient(string accept, string? acceptLanguage = null) =>
    (services, http) =>
    {
        var embeds = services.GetRequiredService<IOptions<EmbedOptions>>().Value;
        http.Timeout = TimeSpan.FromSeconds(Math.Max(1, embeds.TimeoutSeconds));
        http.DefaultRequestHeaders.UserAgent.ParseAdd(embeds.UserAgent);
        http.DefaultRequestHeaders.Accept.ParseAdd(accept);
        if (acceptLanguage is not null)
        {
            http.DefaultRequestHeaders.AcceptLanguage.ParseAdd(acceptLanguage);
        }
    };

static HttpMessageHandler CreateEmbedHandler(IServiceProvider services) =>
    LinkUnfurler.CreateHandler(services.GetRequiredService<IOptions<EmbedOptions>>().Value);

public partial class Program;
