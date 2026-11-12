using System.Security.Cryptography;
using OtpNet;

namespace Stellarr.Api.Auth.Security;

/// <summary>RFC 6238 through Otp.NET, with a single accepted timestep per method row.</summary>
public static class TotpService
{
    private const int SecretBytes = 20;
    private const int Digits = 6;
    private const int StepSeconds = 30;

    public static string NewSecret() => Base32Encoding.ToString(RandomNumberGenerator.GetBytes(SecretBytes));

    public static string OtpAuthUri(string issuer, string accountName, string secret)
    {
        var label = Uri.EscapeDataString($"{issuer}:{accountName}");
        var query = $"secret={Uri.EscapeDataString(secret)}&issuer={Uri.EscapeDataString(issuer)}" +
            $"&algorithm=SHA1&digits={Digits}&period={StepSeconds}";
        return $"otpauth://totp/{label}?{query}";
    }

    public static bool Verify(string secret, string code, out long timeStep)
    {
        timeStep = 0;
        if (code.Trim() is not { Length: Digits } digits || !digits.All(char.IsAsciiDigit))
        {
            return false;
        }

        try
        {
            var totp = new OtpNet.Totp(Base32Encoding.ToBytes(secret), step: StepSeconds, totpSize: Digits);
            return totp.VerifyTotp(
                digits,
                out timeStep,
                new VerificationWindow(previous: 1, future: 1));
        }
        catch (Exception exception) when (exception is ArgumentException or FormatException)
        {
            return false;
        }
    }

    public static string Compute(string secret) =>
        new OtpNet.Totp(Base32Encoding.ToBytes(secret), step: StepSeconds, totpSize: Digits).ComputeTotp();

    public static string ComputeAt(string secret, DateTime timestamp) =>
        new OtpNet.Totp(Base32Encoding.ToBytes(secret), step: StepSeconds, totpSize: Digits)
            .ComputeTotp(timestamp);
}
