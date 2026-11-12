using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;

namespace Stellarr.Api.Auth;

/// <summary>
/// Named limits endpoints opt into. Each policy counts requests in a window of
/// its own: per client address, except for uploads, which share one budget
/// across the instance because their cost is bytes, not callers.
/// </summary>
public static class RateLimitPolicies
{
    public const string Login = "login";
    public const string LoginPoll = "login-poll";
    public const string AuthWrite = "auth-write";

    /// <summary>
    /// Changes to a signed-in or challenged account's own second factor. They
    /// send no mail and already run inside attempt and failure budgets, so
    /// they count apart from <see cref="AuthWrite"/>: one method added after
    /// a fresh proof takes three calls, which left the shared budget empty.
    /// </summary>
    public const string SecurityWrite = "security-write";
    public const string Uploads = "uploads";

    public static IServiceCollection AddRateLimitPolicies(
        this IServiceCollection services,
        IConfiguration configuration,
        IHostEnvironment environment)
    {
        // Tests sign in over and over from one address.
        int PermitLimit(string setting, int fallback) => environment.IsEnvironment("Testing")
            ? 10_000
            : Math.Max(1, configuration.GetValue<int?>($"RateLimiting:{setting}:PermitLimit") ?? fallback);

        var login = PermitLimit("Login", 10);
        // The desktop client polls for the browser's approval every second or
        // two. On the password budget that locked the whole address out of
        // signing in within seconds, so polling counts apart and wider.
        var loginPoll = PermitLimit("LoginPoll", 120);
        var authWrite = PermitLimit("AuthWrite", 5);
        var securityWrite = PermitLimit("SecurityWrite", 30);
        var uploadsPerMinute = PermitLimit("Uploads", 30);
        var concurrentUploads = environment.IsEnvironment("Testing")
            ? 100
            : Math.Clamp(configuration.GetValue<int?>("Uploads:MaxConcurrentUploads") ?? 4, 1, 32);

        return services.AddRateLimiter(options =>
        {
            options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            AddPerAddressPolicy(options, Login, login, TimeSpan.FromMinutes(1));
            AddPerAddressPolicy(options, LoginPoll, loginPoll, TimeSpan.FromMinutes(1));
            AddPerAddressPolicy(options, AuthWrite, authWrite, TimeSpan.FromMinutes(15));
            AddPerAddressPolicy(options, SecurityWrite, securityWrite, TimeSpan.FromMinutes(15));
            AddInstanceUploadPolicy(options, concurrentUploads, uploadsPerMinute);
        });
    }

    /// <summary>
    /// Uploads that run at once, queued briefly, and uploads per minute, both
    /// counted for the whole instance so that no number of callers adds up to
    /// more than the disk and the network can take.
    /// </summary>
    private static void AddInstanceUploadPolicy(RateLimiterOptions options, int concurrent, int perMinute) =>
        options.AddPolicy(Uploads, _ => RateLimitPartition.Get(
            "instance",
            _ => RateLimiter.CreateChained(
                new ConcurrencyLimiter(new ConcurrencyLimiterOptions
                {
                    PermitLimit = concurrent,
                    QueueLimit = concurrent * 4,
                    QueueProcessingOrder = QueueProcessingOrder.OldestFirst,
                }),
                new FixedWindowRateLimiter(new FixedWindowRateLimiterOptions
                {
                    PermitLimit = perMinute,
                    Window = TimeSpan.FromMinutes(1),
                    QueueLimit = 0,
                    AutoReplenishment = true,
                }))));

    private static void AddPerAddressPolicy(RateLimiterOptions options, string name, int permitLimit, TimeSpan window) =>
        options.AddPolicy(name, context => RateLimitPartition.GetFixedWindowLimiter(
            context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = permitLimit,
                Window = window,
                QueueLimit = 0,
                AutoReplenishment = true,
            }));
}
