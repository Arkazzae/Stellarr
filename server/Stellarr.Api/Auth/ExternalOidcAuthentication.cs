using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.OpenIdConnect;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Microsoft.IdentityModel.Tokens;
using Stellarr.Api.Data;
using Stellarr.Api.Localization;

namespace Stellarr.Api.Auth;

/// <summary>
/// Lets a person sign in through the configured OpenID Connect provider. The
/// provider only proves who they are: an account is signed in when a
/// maintainer has linked that identity to it, never by matching an e-mail
/// address. The result is the same revocable session a password sign-in gets.
/// </summary>
public static class ExternalOidcAuthentication
{
    private const string NotLinked = "external_identity_not_linked";

    public static AuthenticationBuilder AddExternalOidc(
        this AuthenticationBuilder authentication,
        ExternalOidcOptions settings)
    {
        if (!settings.IsConfigured)
        {
            return authentication;
        }

        var clientSecret = settings.ResolveClientSecret();
        return authentication.AddOpenIdConnect(
            ExternalOidcOptions.AuthenticationScheme,
            settings.DisplayName,
            options =>
            {
                options.SignInScheme = CookieAuthenticationDefaults.AuthenticationScheme;
                options.Authority = settings.Authority.TrimEnd('/');
                options.ClientId = settings.ClientId;
                options.ClientSecret = clientSecret;
                options.CallbackPath = settings.CallbackPath;
                options.ResponseType = OpenIdConnectResponseType.Code;
                options.UsePkce = true;
                options.MapInboundClaims = false;
                options.GetClaimsFromUserInfoEndpoint = true;
                options.SaveTokens = false;
                options.Scope.Clear();
                options.Scope.Add(OpenIdConnectScope.OpenIdProfile);
                options.Scope.Add(OpenIdConnectScope.Email);
                options.TokenValidationParameters = new TokenValidationParameters
                {
                    NameClaimType = "preferred_username",
                    RoleClaimType = "groups",
                };
                options.Events = new OpenIdConnectEvents
                {
                    OnTokenValidated = SignInLinkedAccountAsync,
                    OnRemoteFailure = RedirectToLoginAsync,
                };
            });
    }

    private static async Task SignInLinkedAccountAsync(TokenValidatedContext context)
    {
        var issuer = ExternalOidcOptions.CanonicalIssuer(context.SecurityToken.Issuer ?? "");
        var subject = context.Principal?.FindFirst("sub")?.Value?.Trim() ?? "";
        if (issuer.Length is 0 or > 512 || subject.Length is 0 or > 255)
        {
            context.Fail("external_identity_invalid");
            return;
        }

        var db = context.HttpContext.RequestServices.GetRequiredService<AppDbContext>();
        var cancellationToken = context.HttpContext.RequestAborted;
        var userId = await db.ExternalIdentities.AsNoTracking()
            .Where(identity => identity.Issuer == issuer && identity.Subject == subject)
            .Select(identity => (Guid?)identity.UserId)
            .SingleOrDefaultAsync(cancellationToken);
        if (userId is null)
        {
            context.Fail(NotLinked);
            return;
        }

        var user = await db.Users.SingleOrDefaultAsync(candidate => candidate.Id == userId, cancellationToken);
        if (user is null || user.IsDisabled)
        {
            context.Fail("external_identity_unavailable");
            return;
        }

        var session = SessionAuthentication.CreateSession(
            context.HttpContext, user.Id, context.HttpContext.RequestServices.GetRequiredService<Messages>());
        db.UserSessions.Add(session);
        await db.SaveChangesAsync(cancellationToken);

        context.Principal = SessionAuthentication.CreatePrincipal(user, session.Id);
        context.Properties ??= new AuthenticationProperties();
        SessionAuthentication.KeepSignedIn(context.Properties);
    }

    /// <summary>Sends a failed or cancelled sign-in back to the login page, saying roughly why.</summary>
    private static Task RedirectToLoginAsync(RemoteFailureContext context)
    {
        var error = context.Failure?.Message.Contains(NotLinked, StringComparison.Ordinal) == true
            ? "not_linked"
            : context.Request.Query["error"] == "access_denied"
                ? "cancelled"
                : "failed";
        context.Response.Redirect($"/login?oidc_error={Uri.EscapeDataString(error)}");
        context.HandleResponse();
        return Task.CompletedTask;
    }
}
