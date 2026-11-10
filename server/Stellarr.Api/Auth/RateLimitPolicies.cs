using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;

namespace Stellarr.Api.Auth;

/// <summary>
/// Named limits endpoints opt into. Each policy counts requests per client
/// address in a window of its own.
/// </summary>
public static class RateLimitPolicies
{
    public const string Login = "login";
    public const string LoginPoll = "login-poll";
    public const string AuthWrite = "auth-write";

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

        return services.AddRateLimiter(options =>
        {
            options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            AddPerAddressPolicy(options, Login, login, TimeSpan.FromMinutes(1));
            AddPerAddressPolicy(options, LoginPoll, loginPoll, TimeSpan.FromMinutes(1));
            AddPerAddressPolicy(options, AuthWrite, authWrite, TimeSpan.FromMinutes(15));
        });
    }

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
