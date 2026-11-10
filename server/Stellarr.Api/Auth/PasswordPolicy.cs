namespace Stellarr.Api.Auth;

/// <summary>
/// What a password must look like, for every place that accepts a new one:
/// registration, a change from the account settings and a reset by mail.
/// </summary>
public static class PasswordPolicy
{
    public const int MinLength = 8;
    public const int MaxLength = 256;

    public static bool IsTooShort(string? password) => password is null || password.Length < MinLength;

    public static bool IsTooLong(string? password) => password is { Length: > MaxLength };

    /// <summary>The text shown for a password the policy refuses, or null when it is acceptable.</summary>
    public static string? Violation(string? password)
    {
        if (IsTooShort(password))
        {
            return $"Hasło musi mieć co najmniej {MinLength} znaków.";
        }

        return IsTooLong(password) ? $"Hasło może mieć najwyżej {MaxLength} znaków." : null;
    }
}
