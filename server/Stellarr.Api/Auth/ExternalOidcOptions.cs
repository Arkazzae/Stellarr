namespace Stellarr.Api.Auth;

/// <summary>
/// Settings of the optional sign-in through OpenID Connect providers, bound
/// from the <c>Oidc</c> configuration section. The provider configured at the
/// top of the section keeps the original callback and the id
/// <see cref="DefaultProviderId"/>; more can be added under
/// <c>Oidc:Providers:{id}</c>, each with a sign-in button and a callback of
/// its own.
/// </summary>
public sealed class ExternalOidcOptions
{
    public const string SectionName = "Oidc";
    public const string AuthenticationScheme = "external-oidc";
    public const string DefaultProviderId = "default";

    /// <summary>Ids a named provider cannot take: the original one, and the words of the routes.</summary>
    private static readonly string[] ReservedIds = [DefaultProviderId, "login", "callback", "link"];

    public bool Enabled { get; init; }
    public string Authority { get; init; } = "";
    public string ClientId { get; init; } = "";
    public string ClientSecret { get; init; } = "";

    /// <summary>A file holding the secret, for deployments that mount secrets instead of passing them.</summary>
    public string ClientSecretFile { get; init; } = "";

    /// <summary>The name of the sign-in button; blank shows a default in the language of the instance.</summary>
    public string DisplayName { get; init; } = "";
    public string CallbackPath { get; init; } = "/api/auth/oidc/callback";

    /// <summary>See <see cref="ExternalOidcProvider.TrustProviderMfa"/>.</summary>
    public bool TrustProviderMfa { get; init; }

    /// <summary>See <see cref="ExternalOidcProvider.ProviderMfaAmr"/>.</summary>
    public string ProviderMfaAmr { get; init; } = ExternalOidcProvider.DefaultMfaAmr;

    /// <summary>Further providers, by id.</summary>
    public Dictionary<string, ExternalOidcProvider> Providers { get; init; } = new(StringComparer.Ordinal);

    /// <summary>
    /// True when the provider at the top of the section can really work: it
    /// is reached over HTTPS and the client is a confidential one with a secret.
    /// </summary>
    public bool IsConfigured => Original().IsConfigured;

    /// <summary>The inline secret, else the content of the secret file, else an empty string.</summary>
    public string ResolveClientSecret() => Original().ResolveClientSecret();

    /// <summary>
    /// Every provider that can really be used: the original one first, then
    /// the named ones in the order of their ids. A named provider whose id is
    /// not a short lower-case name stops the start, since its callback could
    /// not be registered with the provider as written.
    /// </summary>
    public IReadOnlyList<ExternalOidcProvider> ConfiguredProviders()
    {
        var providers = new List<ExternalOidcProvider>();
        if (Original() is { IsConfigured: true } original)
        {
            providers.Add(original);
        }

        foreach (var (id, provider) in Providers.OrderBy(x => x.Key, StringComparer.Ordinal))
        {
            if (!IsValidId(id))
            {
                throw new InvalidOperationException(
                    $"Oidc:Providers:{id} is not a valid provider id: use 1 to 32 lower-case letters, digits or hyphens, not {string.Join(", ", ReservedIds)}.");
            }

            var named = provider.Named(id, $"/api/auth/oidc/{id}/callback");
            if (named.IsConfigured)
            {
                providers.Add(named);
            }
        }

        return providers;
    }

    public ExternalOidcProvider? Find(string id) =>
        ConfiguredProviders().FirstOrDefault(x => x.Id == id);

    private static bool IsValidId(string id) =>
        id.Length is >= 1 and <= 32 &&
        id.All(c => c is (>= 'a' and <= 'z') or (>= '0' and <= '9') or '-') &&
        id[0] != '-' &&
        !ReservedIds.Contains(id, StringComparer.Ordinal);

    private ExternalOidcProvider Original() => new ExternalOidcProvider
    {
        Enabled = Enabled,
        Authority = Authority,
        ClientId = ClientId,
        ClientSecret = ClientSecret,
        ClientSecretFile = ClientSecretFile,
        DisplayName = DisplayName,
        TrustProviderMfa = TrustProviderMfa,
        ProviderMfaAmr = ProviderMfaAmr,
    }.Named(DefaultProviderId, CallbackPath);

    /// <summary>An issuer as it is stored: providers differ on a trailing slash.</summary>
    public static string CanonicalIssuer(string issuer) => issuer.Trim().TrimEnd('/');

    /// <summary>
    /// Where to send the person once signed in. Only a path on this origin is
    /// accepted, so the sign-in link cannot be used to bounce them elsewhere.
    /// </summary>
    public static string SafeReturnUrl(string? returnUrl)
    {
        var candidate = returnUrl?.Trim() ?? "";
        string decoded;
        try
        {
            decoded = Uri.UnescapeDataString(candidate);
        }
        catch (UriFormatException)
        {
            return "/";
        }

        return LeadsHere(candidate) && LeadsHere(decoded) ? candidate : "/";
    }

    /// <summary>
    /// A rooted path no browser reads as another host. "." and ".." segments
    /// are refused too: a URL parser folds them, so <c>/.//host</c> would
    /// become <c>//host</c> on the page that follows the path.
    /// </summary>
    private static bool LeadsHere(string path)
    {
        if (!path.StartsWith('/') ||
            path.StartsWith("//", StringComparison.Ordinal) ||
            path.Contains('\\', StringComparison.Ordinal) ||
            path.Any(char.IsControl))
        {
            return false;
        }

        var route = path.Split('?', '#')[0];
        return !route.Split('/').Any(segment => segment is "." or "..");
    }
}

/// <summary>One OpenID Connect provider people can sign in through.</summary>
public sealed class ExternalOidcProvider
{
    public const string DefaultMfaAmr = "mfa";

    public bool Enabled { get; init; } = true;
    public string Authority { get; init; } = "";
    public string ClientId { get; init; } = "";
    public string ClientSecret { get; init; } = "";
    public string ClientSecretFile { get; init; } = "";
    public string DisplayName { get; init; } = "";

    /// <summary>
    /// Off by default: the provider only proves who someone is, and the
    /// instance asks for its own second step after it. On, a sign-in whose ID
    /// token lists one of <see cref="ProviderMfaAmr"/> in its <c>amr</c> claim
    /// counts as having passed a second step at the provider.
    /// </summary>
    public bool TrustProviderMfa { get; init; }

    /// <summary>The <c>amr</c> values, comma-separated, that mean the provider asked for more than a password.</summary>
    public string ProviderMfaAmr { get; init; } = DefaultMfaAmr;

    /// <summary>The id in the provider's routes; <see cref="ExternalOidcOptions.DefaultProviderId"/> for the original one.</summary>
    public string Id { get; private init; } = "";

    public string CallbackPath { get; private init; } = "";

    public string Scheme => Id == ExternalOidcOptions.DefaultProviderId
        ? ExternalOidcOptions.AuthenticationScheme
        : $"{ExternalOidcOptions.AuthenticationScheme}-{Id}";

    /// <summary>Where the sign-in button sends people.</summary>
    public string LoginPath => Id == ExternalOidcOptions.DefaultProviderId
        ? "/api/auth/oidc/login"
        : $"/api/auth/oidc/{Id}/login";

    /// <summary>Where a signed-in account goes to link itself to this provider, with a ticket.</summary>
    public string LinkPath => Id == ExternalOidcOptions.DefaultProviderId
        ? "/api/auth/oidc/link"
        : $"/api/auth/oidc/{Id}/link";

    public bool IsConfigured =>
        Enabled &&
        Uri.TryCreate(Authority, UriKind.Absolute, out var authority) &&
        authority.Scheme == Uri.UriSchemeHttps &&
        !string.IsNullOrWhiteSpace(ClientId) &&
        ResolveClientSecret().Length > 0 &&
        CallbackPath.StartsWith('/');

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

    /// <summary>
    /// How recent the provider's own sign-in must be to count. The provider is
    /// asked for it with <c>max_age</c>, and its <c>auth_time</c> must show it,
    /// so a sign-in the provider waved through on an old session does not
    /// count as a fresh second step here.
    /// </summary>
    public static readonly TimeSpan ProviderMfaMaxAge = Security.MfaPolicy.FreshMfaWindow;

    private static readonly TimeSpan ClockSkew = TimeSpan.FromMinutes(1);

    /// <summary>
    /// Whether the provider says it asked for more than a password, recently
    /// enough, and the instance trusts it to.
    /// </summary>
    public bool PassedSecondStep(IEnumerable<string> amr, string? authTime, DateTimeOffset now)
    {
        if (!TrustProviderMfa ||
            !long.TryParse(authTime, System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out var seconds))
        {
            return false;
        }

        var signedIn = DateTimeOffset.FromUnixTimeSeconds(Math.Clamp(seconds, 0, 253402300799));
        if (signedIn > now + ClockSkew || signedIn < now - ProviderMfaMaxAge - ClockSkew)
        {
            return false;
        }

        var accepted = ProviderMfaAmr
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .ToHashSet(StringComparer.Ordinal);
        return amr.Any(accepted.Contains);
    }

    internal ExternalOidcProvider Named(string id, string callbackPath) => new()
    {
        Enabled = Enabled,
        Authority = Authority,
        ClientId = ClientId,
        ClientSecret = ClientSecret,
        ClientSecretFile = ClientSecretFile,
        DisplayName = DisplayName,
        TrustProviderMfa = TrustProviderMfa,
        ProviderMfaAmr = ProviderMfaAmr,
        Id = id,
        CallbackPath = callbackPath,
    };
}
