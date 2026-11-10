using System.Security.Cryptography;
using System.Text;

namespace Stellarr.Api.Realtime;

public sealed record TurnCredentials(string Username, string Credential, DateTimeOffset ExpiresAt);

/// <summary>
/// Issues short-lived credentials for the TURN relay, which verifies them
/// with the shared secret instead of keeping an account for every caller.
/// </summary>
public sealed class TurnCredentialService(IConfiguration configuration)
{
    /// <summary>Only reachable in development and tests: startup refuses to run elsewhere without a secret.</summary>
    private const string DevelopmentSecret = "stellarr-turn-development-secret";

    private static readonly TimeSpan Lifetime = TimeSpan.FromHours(1);

    public TurnCredentials Create(Guid userId)
    {
        var secret = configuration["Rtc:TurnSharedSecret"];
        if (string.IsNullOrWhiteSpace(secret))
        {
            secret = DevelopmentSecret;
        }

        var expiresAt = DateTimeOffset.UtcNow.Add(Lifetime);
        var username = $"{expiresAt.ToUnixTimeSeconds()}:{userId:N}";
        // The relay's time-limited credential scheme (the TURN REST API) is
        // defined in terms of HMAC-SHA1. It authenticates a message with a
        // secret; it does not hash passwords.
#pragma warning disable CA5350
        var mac = HMACSHA1.HashData(Encoding.UTF8.GetBytes(secret), Encoding.UTF8.GetBytes(username));
#pragma warning restore CA5350
        return new TurnCredentials(username, Convert.ToBase64String(mac), expiresAt);
    }
}
