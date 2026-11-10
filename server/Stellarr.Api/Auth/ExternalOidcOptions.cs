namespace Stellarr.Api.Auth;

/// <summary>
/// Settings of the optional single sign-on through an OpenID Connect provider,
/// bound from the <c>Oidc</c> configuration section.
/// </summary>
public sealed class ExternalOidcOptions
{
    public const string SectionName = "Oidc";
    public const string AuthenticationScheme = "external-oidc";

    public bool Enabled { get; init; }
    public string Authority { get; init; } = "";
    public string ClientId { get; init; } = "";
    public string ClientSecret { get; init; } = "";

    /// <summary>A file holding the secret, for deployments that mount secrets instead of passing them.</summary>
    public string ClientSecretFile { get; init; } = "";

    /// <summary>The name of the sign-in button; blank shows a default in the language of the instance.</summary>
    public string DisplayName { get; init; } = "";
    public string CallbackPath { get; init; } = "/api/auth/oidc/callback";

    /// <summary>
    /// True when sign-in can really work: the provider is reached over HTTPS
    /// and the client is a confidential one with a secret.
    /// </summary>
    public bool IsConfigured =>
        Enabled &&
        Uri.TryCreate(Authority, UriKind.Absolute, out var authority) &&
        authority.Scheme == Uri.UriSchemeHttps &&
        !string.IsNullOrWhiteSpace(ClientId) &&
        ResolveClientSecret().Length > 0 &&
        CallbackPath.StartsWith('/');

    /// <summary>The inline secret, else the content of the secret file, else an empty string.</summary>
    public string ResolveClientSecret()
    {
        var inline = ClientSecret.Trim();
        if (inline.Length > 0 || ClientSecretFile.Trim() is not { Length: > 0 } path)
        {
            return inline;
        }

        try
        {
            return File.ReadAllText(path).Trim();
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or ArgumentException)
        {
            return "";
        }
    }

    /// <summary>An issuer as it is stored: providers differ on a trailing slash.</summary>
    public static string CanonicalIssuer(string issuer) => issuer.Trim().TrimEnd('/');

    /// <summary>
    /// Where to send the person once signed in. Only a path on this origin is
    /// accepted, so the sign-in link cannot be used to bounce them elsewhere.
    /// </summary>
    public static string SafeReturnUrl(string? returnUrl)
    {
        var candidate = returnUrl?.Trim() ?? "";
        var staysHere = candidate.StartsWith('/') &&
            !candidate.StartsWith("//", StringComparison.Ordinal) &&
            !candidate.StartsWith("/\\", StringComparison.Ordinal);
        return staysHere ? candidate : "/";
    }
}
