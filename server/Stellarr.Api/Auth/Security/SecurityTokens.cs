using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.AspNetCore.DataProtection;

namespace Stellarr.Api.Auth.Security;

public static class SecurityTokens
{
    public static string Random(int bytes) => WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(bytes));

    public static string RandomDigits(int digits) =>
        RandomNumberGenerator.GetInt32(0, (int)Math.Pow(10, digits)).ToString($"D{digits}", System.Globalization.CultureInfo.InvariantCulture);

    /// <summary>High-entropy text without characters that are easy to confuse when retyped.</summary>
    public static string RandomText(int length)
    {
        const string alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        return new string(Enumerable.Range(0, length)
            .Select(_ => alphabet[RandomNumberGenerator.GetInt32(0, alphabet.Length)])
            .ToArray());
    }

    public static string Hash(string value) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));

    public static bool Matches(string supplied, string storedHash)
    {
        if (storedHash.Length != 64)
        {
            return false;
        }

        return CryptographicOperations.FixedTimeEquals(
            Encoding.ASCII.GetBytes(Hash(supplied)),
            Encoding.ASCII.GetBytes(storedHash));
    }

    public static bool FixedTimeEquals(string left, string right) =>
        CryptographicOperations.FixedTimeEquals(
            Encoding.UTF8.GetBytes(left),
            Encoding.UTF8.GetBytes(right));
}

public static class SecurityProtection
{
    private const string TotpPurpose = "Stellarr.AccountSecurity.Totp.v1";
    private const string EmailPurpose = "Stellarr.AccountSecurity.EmailOtp.v1";

    public static string ProtectTotp(
        IDataProtectionProvider provider,
        Guid userId,
        Guid methodId,
        string secret) =>
        provider.CreateProtector(TotpPurpose, userId.ToString("N"), methodId.ToString("N"))
            .Protect(secret);

    public static string UnprotectTotp(
        IDataProtectionProvider provider,
        Guid userId,
        Guid methodId,
        string protectedSecret) =>
        provider.CreateProtector(TotpPurpose, userId.ToString("N"), methodId.ToString("N"))
            .Unprotect(protectedSecret);

    public static string ProtectEmailCode(
        IDataProtectionProvider provider,
        Guid userId,
        string purpose,
        string code) =>
        provider.CreateProtector(EmailPurpose, userId.ToString("N"), purpose).Protect(code);

    public static bool EmailCodeMatches(
        IDataProtectionProvider provider,
        Guid userId,
        string purpose,
        string protectedCode,
        string supplied)
    {
        try
        {
            var code = provider.CreateProtector(EmailPurpose, userId.ToString("N"), purpose)
                .Unprotect(protectedCode);
            return SecurityTokens.FixedTimeEquals(code, supplied);
        }
        catch (CryptographicException)
        {
            return false;
        }
    }
}

/// <summary>
/// The HttpOnly cookies that carry a short-lived challenge and a remembered
/// device. Neither is a session cookie and neither can authorize an API call.
/// </summary>
public static class SecurityCookies
{
    private const string PreauthHost = "__Host-stellarr-preauth";
    private const string PreauthDev = "stellarr-dev-preauth";
    private const string TrustHost = "__Host-stellarr-trust";
    private const string TrustDev = "stellarr-dev-trust";

    public static void SetPreauth(HttpContext context, Guid challengeId, string secret, DateTime expiresAt)
    {
        context.Response.Cookies.Append(
            PreauthName(context),
            $"{challengeId:N}.{secret}",
            CookieOptions(context, expiresAt));
    }

    public static (Guid Id, string Secret)? ReadPreauth(HttpContext context)
    {
        var value = context.Request.Cookies[PreauthName(context)];
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        var separator = value.IndexOf('.');
        return separator > 0 &&
            Guid.TryParseExact(value[..separator], "N", out var id) &&
            value[(separator + 1)..] is { Length: > 0 } secret
                ? (id, secret)
                : null;
    }

    public static void ClearPreauth(HttpContext context) =>
        context.Response.Cookies.Delete(PreauthName(context), CookieOptions(context, DateTime.UnixEpoch));

    public static void SetTrustedDevice(HttpContext context, string token, DateTime expiresAt) =>
        context.Response.Cookies.Append(TrustName(context), token, CookieOptions(context, expiresAt));

    public static string? ReadTrustedDevice(HttpContext context) =>
        context.Request.Cookies[TrustName(context)];

    public static void ClearTrustedDevice(HttpContext context) =>
        context.Response.Cookies.Delete(TrustName(context), CookieOptions(context, DateTime.UnixEpoch));

    private static string PreauthName(HttpContext context) => context.Request.IsHttps ? PreauthHost : PreauthDev;

    private static string TrustName(HttpContext context) => context.Request.IsHttps ? TrustHost : TrustDev;

    private static CookieOptions CookieOptions(HttpContext context, DateTime expiresAt) => new()
    {
        HttpOnly = true,
        Secure = context.Request.IsHttps,
        SameSite = SameSiteMode.Lax,
        Path = "/",
        Expires = new DateTimeOffset(expiresAt, TimeSpan.Zero),
    };
}
