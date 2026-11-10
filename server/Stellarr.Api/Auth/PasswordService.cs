using System.Globalization;
using System.Security.Cryptography;

namespace Stellarr.Api.Auth;

/// <summary>
/// Hashes passwords as <c>pbkdf2-sha256$iterations$salt$hash</c> with both
/// binary parts in base64. Hashes written with another iteration count still
/// verify, as long as the count stays inside the accepted window.
/// </summary>
public sealed class PasswordService
{
    private const string Scheme = "pbkdf2-sha256";
    private const int Iterations = 210_000;
    private const int MinimumAcceptedIterations = 100_000;
    private const int MaximumAcceptedIterations = 1_000_000;
    private const int SaltSize = 16;
    private const int HashSize = 32;

    public string Hash(string password)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(password);

        var salt = RandomNumberGenerator.GetBytes(SaltSize);
        var hash = Derive(password, salt, Iterations);
        return string.Join('$', Scheme, Iterations, Convert.ToBase64String(salt), Convert.ToBase64String(hash));
    }

    public bool Verify(string password, string encoded)
    {
        var parts = encoded.Split('$');
        if (parts.Length != 4 ||
            parts[0] != Scheme ||
            !int.TryParse(parts[1], NumberStyles.Integer, CultureInfo.InvariantCulture, out var iterations) ||
            iterations is < MinimumAcceptedIterations or > MaximumAcceptedIterations ||
            !TryDecode(parts[2], SaltSize, out var salt) ||
            !TryDecode(parts[3], HashSize, out var expected))
        {
            return false;
        }

        return CryptographicOperations.FixedTimeEquals(Derive(password, salt, iterations), expected);
    }

    private static byte[] Derive(string password, byte[] salt, int iterations) =>
        Rfc2898DeriveBytes.Pbkdf2(password, salt, iterations, HashAlgorithmName.SHA256, HashSize);

    private static bool TryDecode(string base64, int expectedLength, out byte[] bytes)
    {
        bytes = new byte[expectedLength];
        return Convert.TryFromBase64String(base64, bytes, out var written) && written == expectedLength;
    }
}
