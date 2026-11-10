using Amazon.Runtime;
using Amazon.S3;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Stellarr.Api.Auth;
using Stellarr.Api.Data;
using Stellarr.Api.Endpoints;
using Stellarr.Api.Logging;
using Stellarr.Api.Realtime;
using Stellarr.Api.Storage;

var builder = WebApplication.CreateBuilder(args);

var dataRoot = builder.Configuration["DataRoot"] ?? "data";
var keysDirectory = Directory.CreateDirectory(Path.Combine(dataRoot, "keys"));

builder.Services.AddProblemDetails();
// The keys that protect the session cookie live on the data volume, so a
// restart or a new container does not sign everybody out.
builder.Services.AddDataProtection()
    .SetApplicationName("Stellarr")
    .PersistKeysToFileSystem(keysDirectory);

builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseSqlite(builder.Configuration.GetConnectionString("Database")));
builder.Services.AddSingleton<PasswordService>();
builder.Services.AddSingleton<PresenceTracker>();

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

app.UseExceptionHandler();
app.UseForwardedHeaders();
if (app.Environment.IsDevelopment())
{
    app.UseCors();
}
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();

app.MapGet("/health/live", () => Results.Ok(new { status = "live" }));
app.MapGet("/health/ready", async (AppDbContext db, CancellationToken cancellationToken) =>
    await db.Database.CanConnectAsync(cancellationToken)
        ? Results.Ok(new { status = "ready" })
        : Results.Problem(statusCode: StatusCodes.Status503ServiceUnavailable, title: "Database unavailable"));

app.MapAuthEndpoints();
app.MapDesktopBrowserLoginEndpoints();
app.MapSessionEndpoints();

await InitializeApplicationAsync(app);
await app.RunAsync();

// Runs before the host starts serving, so hosted services and requests only
// ever see a database and an object store that are ready.
static async Task InitializeApplicationAsync(WebApplication app)
{
    var stopping = app.Lifetime.ApplicationStopping;
    await using (var scope = app.Services.CreateAsyncScope())
    {
        await DatabaseSchema.UpgradeAsync(scope.ServiceProvider.GetRequiredService<AppDbContext>(), stopping);
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

public partial class Program;
