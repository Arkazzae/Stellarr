using Stellarr.Api.Localization;

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
    public static string? Violation(string? password, Messages messages)
    {
        if (IsTooShort(password))
        {
            return messages.Get(MessageKey.PasswordTooShort, ("min", MinLength));
        }

        return IsTooLong(password) ? messages.Get(MessageKey.PasswordTooLong, ("max", MaxLength)) : null;
    }
}
