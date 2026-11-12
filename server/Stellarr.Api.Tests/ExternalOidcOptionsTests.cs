using Stellarr.Api.Auth;

namespace Stellarr.Api.Tests;

public sealed class ExternalOidcOptionsTests
{
    [Theory]
    [InlineData(null, "/")]
    [InlineData("", "/")]
    [InlineData("/", "/")]
    [InlineData("/invite/abc?source=oidc", "/invite/abc?source=oidc")]
    [InlineData("https://evil.example/", "/")]
    [InlineData("//evil.example/", "/")]
    [InlineData("/\\evil.example/", "/")]
    [InlineData("/.//evil.example", "/")]
    [InlineData("/%2e//evil.example", "/")]
    [InlineData("/a/..//evil.example", "/")]
    [InlineData("/%2F%2Fevil.example", "/")]
    [InlineData("/invite/v1.2", "/invite/v1.2")]
    public void ReturnUrlMustStayOnTheCurrentOrigin(string? value, string expected)
    {
        Assert.Equal(expected, ExternalOidcOptions.SafeReturnUrl(value));
    }

    [Theory]
    [InlineData("Work")]
    [InlineData("work space")]
    [InlineData("-work")]
    [InlineData("default")]
    [InlineData("login")]
    [InlineData("callback")]
    public void NamedProviderNeedsAShortLowerCaseIdThatNoRouteUses(string id)
    {
        var options = new ExternalOidcOptions
        {
            Providers = new Dictionary<string, ExternalOidcProvider>
            {
                [id] = new() { Authority = "https://work.example.test", ClientId = "stellarr", ClientSecret = "secret" },
            },
        };

        Assert.Throws<InvalidOperationException>(() => options.ConfiguredProviders());
    }

    [Fact]
    public void ProvidersAreListedOriginalFirstWithTheirOwnCallbacks()
    {
        var options = new ExternalOidcOptions
        {
            Enabled = true,
            Authority = "https://auth.example.test",
            ClientId = "stellarr",
            ClientSecret = "secret",
            Providers = new Dictionary<string, ExternalOidcProvider>
            {
                ["work"] = new() { Authority = "https://work.example.test", ClientId = "stellarr", ClientSecret = "secret" },
                // Not over HTTPS: left out, like an unconfigured original.
                ["lab"] = new() { Authority = "http://lab.example.test", ClientId = "stellarr", ClientSecret = "secret" },
            },
        };

        var providers = options.ConfiguredProviders();

        Assert.Equal(["default", "work"], providers.Select(x => x.Id));
        Assert.Equal(["/api/auth/oidc/callback", "/api/auth/oidc/work/callback"], providers.Select(x => x.CallbackPath));
        Assert.Equal(["external-oidc", "external-oidc-work"], providers.Select(x => x.Scheme));
        Assert.False(providers[1].PassedSecondStep(["mfa"]));
    }

    [Fact]
    public void OidcRequiresHttpsAndAllConfidentialClientSettings()
    {
        var configured = new ExternalOidcOptions
        {
            Enabled = true,
            Authority = "https://auth.example.test/application/o/stellarr/",
            ClientId = "stellarr",
            ClientSecret = "secret",
        };
        var insecure = new ExternalOidcOptions
        {
            Enabled = true,
            Authority = "http://auth.example.test/application/o/stellarr/",
            ClientId = "stellarr",
            ClientSecret = "secret",
        };

        Assert.True(configured.IsConfigured);
        Assert.False(insecure.IsConfigured);
    }

    [Fact]
    public void OidcCanReadTheClientSecretFromAFile()
    {
        var secretFile = Path.GetTempFileName();
        try
        {
            File.WriteAllText(secretFile, "  file-backed-secret\n");
            var configured = new ExternalOidcOptions
            {
                Enabled = true,
                Authority = "https://auth.example.test",
                ClientId = "stellarr",
                ClientSecretFile = secretFile,
            };

            Assert.True(configured.IsConfigured);
            Assert.Equal("file-backed-secret", configured.ResolveClientSecret());
        }
        finally
        {
            File.Delete(secretFile);
        }
    }
}
