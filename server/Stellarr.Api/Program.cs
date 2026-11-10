using Amazon.Runtime;
using Amazon.S3;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.Extensions.Options;
using Stellarr.Api.Logging;
using Stellarr.Api.Storage;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddProblemDetails();

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

app.MapGet("/health/live", () => Results.Ok(new { status = "live" }));

await InitializeApplicationAsync(app);
await app.RunAsync();

// Runs before the host starts serving, so hosted services and requests only
// ever see a store that is ready.
static async Task InitializeApplicationAsync(WebApplication app)
{
    if (app.Configuration.GetValue<bool>("Storage:SkipInitialization"))
    {
        return;
    }

    // The object store usually starts next to this process and needs a moment.
    const int maxAttempts = 30;
    var storage = app.Services.GetRequiredService<IObjectStorage>();
    var stopping = app.Lifetime.ApplicationStopping;
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
