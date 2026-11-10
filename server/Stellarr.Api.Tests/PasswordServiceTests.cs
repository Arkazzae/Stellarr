using Stellarr.Api.Auth;

namespace Stellarr.Api.Tests;

public sealed class PasswordServiceTests
{
    private readonly PasswordService _passwords = new();

    [Fact]
    public void HashesAndVerifiesPassword()
    {
        var encoded = _passwords.Hash("correct horse battery staple");

        Assert.True(_passwords.Verify("correct horse battery staple", encoded));
        Assert.False(_passwords.Verify("wrong password", encoded));
    }

    [Theory]
    [MemberData(nameof(MalformedHashes))]
    public void RejectsMalformedHashWithoutThrowing(string encoded)
    {
        Assert.False(_passwords.Verify("password", encoded));
    }

    public static TheoryData<string> MalformedHashes()
    {
        var salt = Convert.ToBase64String(new byte[16]);
        var hash = Convert.ToBase64String(new byte[32]);
        return new TheoryData<string>
        {
            "",
            "not-a-password-hash",
            $"pbkdf2-sha512$210000${salt}${hash}",
            $"pbkdf2-sha256$0${salt}${hash}",
            $"pbkdf2-sha256$99999${salt}${hash}",
            $"pbkdf2-sha256$1000001${salt}${hash}",
            $"pbkdf2-sha256$210000$not-base64${hash}",
            $"pbkdf2-sha256$210000${Convert.ToBase64String(new byte[15])}${hash}",
            $"pbkdf2-sha256$210000${salt}${Convert.ToBase64String(new byte[31])}",
        };
    }
}
