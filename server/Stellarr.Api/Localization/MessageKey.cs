namespace Stellarr.Api.Localization;

/// <summary>
/// Everything the server says to people. Each key has a text in every language
/// of the catalog; <see cref="Messages"/> looks it up.
/// </summary>
public enum MessageKey
{
    // Client gate and sign-in
    ClientUnsupported,
    ClientVersionMissing,
    ClientOutdated,
    SignInFailed,
}
