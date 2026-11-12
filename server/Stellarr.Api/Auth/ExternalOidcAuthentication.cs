using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.OpenIdConnect;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Microsoft.IdentityModel.Tokens;
using Stellarr.Api.Auth.Security;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;
using Stellarr.Api.Localization;

namespace Stellarr.Api.Auth;

/// <summary>
/// Lets a person sign in through the configured OpenID Connect providers. A
/// provider only proves who they are: an account is signed in when that
/// identity was linked to it, by the account itself after a fresh proof or by
/// an operator, never by matching an e-mail address. The result is the same
/// revocable session a password sign-in gets.
/// </summary>
public static class ExternalOidcAuthentication
{
    private const string NotLinked = "external_identity_not_linked";

    public static AuthenticationBuilder AddExternalOidc(
        this AuthenticationBuilder authentication,
        ExternalOidcOptions settings)
    {
        foreach (var provider in settings.ConfiguredProviders())
        {
            AddProvider(authentication, provider);
        }

        return authentication;
    }

    private static void AddProvider(AuthenticationBuilder authentication, ExternalOidcProvider provider)
    {
        var clientSecret = provider.ResolveClientSecret();
        authentication.AddOpenIdConnect(
            provider.Scheme,
            provider.DisplayName,
            options =>
            {
                options.SignInScheme = CookieAuthenticationDefaults.AuthenticationScheme;
                options.Authority = provider.Authority.TrimEnd('/');
                options.ClientId = provider.ClientId;
                options.ClientSecret = clientSecret;
                options.CallbackPath = provider.CallbackPath;
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
                    OnTokenValidated = context => SignInLinkedAccountAsync(context, provider),
                    OnRemoteFailure = RedirectToLoginAsync,
                };
            });
    }

    private static async Task SignInLinkedAccountAsync(TokenValidatedContext context, ExternalOidcProvider provider)
    {
        var issuer = ExternalOidcOptions.CanonicalIssuer(context.SecurityToken.Issuer ?? "");
        var subject = context.Principal?.FindFirst("sub")?.Value?.Trim() ?? "";
        // A link started from the settings never signs anyone in.
        if (IdentityLinks.Recall(context.Properties) is { } link)
        {
            var result = issuer.Length is 0 or > 512 || subject.Length is 0 or > 255
                ? "failed"
                : await LinkIdentityAsync(context.HttpContext, provider, link, issuer, subject);
            context.Response.Redirect($"/link-account?result={result}");
            context.HandleResponse();
            return;
        }

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

        var messages = context.HttpContext.RequestServices.GetRequiredService<Messages>();
        var policy = await MfaPolicy.LoadAsync(db, cancellationToken);
        var shortLived = IsShortLived(context.Properties);
        // Off unless the operator trusts this provider's own second step.
        var secondStepAtProvider = provider.PassedSecondStep(
            context.Principal?.FindAll("amr").Select(claim => claim.Value) ?? []);
        var start = await AuthenticationFlow.StartAsync(
            db, context.HttpContext, user, "oidc", policy, messages, cancellationToken,
            shortLived: shortLived, secondStepAtProvider: secondStepAtProvider);
        if (start.RecoveryRequired)
        {
            // The recovery is finished on the sign-in page, which has to know
            // the choice made before leaving for the provider.
            context.Response.Redirect(shortLived
                ? "/login?security_recovery_required=1&keep_signed_in=0"
                : "/login?security_recovery_required=1");
            context.HandleResponse();
            return;
        }

        if (start.Session is not { } session)
        {
            await db.SaveChangesAsync(cancellationToken);
            var page = start.Challenge?.Status == "mfa_enrollment_required"
                ? "/login?mfa_enrollment=1"
                : "/login?mfa_required=1";
            var returnUrl = context.Properties?.RedirectUri;
            if (!string.IsNullOrWhiteSpace(returnUrl))
            {
                page += $"&returnUrl={Uri.EscapeDataString(returnUrl)}";
            }

            context.Response.Redirect(page);
            context.HandleResponse();
            return;
        }

        db.UserSessions.Add(session);
        SecurityEvents.Record(
            db, user.Id, SecurityEventKinds.LoginSucceeded, context.HttpContext, "oidc",
            await SecurityEvents.VerifiedEmailAsync(db, user.Id, cancellationToken));
        await db.SaveChangesAsync(cancellationToken);

        context.Principal = SessionAuthentication.CreatePrincipal(user, session.Id);
        context.Properties ??= new AuthenticationProperties();
        SessionAuthentication.ApplyLifetime(context.Properties, shortLived);
    }

    private const string ShortLivedItem = "stellarr.short-lived";

    internal static void RememberShortLived(AuthenticationProperties properties, bool shortLived)
    {
        if (shortLived)
        {
            properties.Items[ShortLivedItem] = "true";
        }
    }

    private static bool IsShortLived(AuthenticationProperties? properties) =>
        properties?.Items.TryGetValue(ShortLivedItem, out var value) == true && value == "true";

    /// <summary>
    /// Links the identity to the account the link was started for. The
    /// provider's answer is a cross-site POST without the session cookie, so
    /// the session named in the protected state is checked here instead:
    /// still active, on the account's current security version, and the
    /// account neither disabled nor waiting for an operator's recovery.
    /// </summary>
    private static async Task<string> LinkIdentityAsync(
        HttpContext context,
        ExternalOidcProvider provider,
        IdentityLinkRequest link,
        string issuer,
        string subject)
    {
        var db = context.RequestServices.GetRequiredService<AppDbContext>();
        var cancellationToken = context.RequestAborted;
        var now = DateTime.UtcNow;
        var legacyCutoff = now - SessionAuthentication.Lifetime;
        var user = await db.Users.SingleOrDefaultAsync(x => x.Id == link.UserId, cancellationToken);
        var sessionActive = user is not null && await db.UserSessions.AsNoTracking().AnyAsync(
            x => x.Id == link.SessionId &&
                x.UserId == link.UserId &&
                x.RevokedAt == null &&
                x.ExpiresAt > now &&
                (x.AbsoluteExpiresAt > now || (x.AbsoluteExpiresAt == null && x.CreatedAt > legacyCutoff)) &&
                x.SecurityVersion == link.SecurityVersion,
            cancellationToken);
        if (user is null || !sessionActive || user.IsDisabled || user.SecurityRecoveryRequired ||
            user.SessionVersion != link.SecurityVersion || link.ProviderId != provider.Id)
        {
            return "failed";
        }

        var existing = await db.ExternalIdentities.AsNoTracking()
            .Where(x => (x.Issuer == issuer && x.Subject == subject) || (x.UserId == user.Id && x.Issuer == issuer))
            .ToListAsync(cancellationToken);
        if (existing.Any(x => x.Issuer == issuer && x.Subject == subject && x.UserId == user.Id))
        {
            return "linked";
        }

        if (existing.Count > 0)
        {
            // Someone else's identity, or another one at this provider already on this account.
            return existing.Any(x => x.UserId != user.Id) ? "taken" : "other";
        }

        db.ExternalIdentities.Add(new ExternalIdentity
        {
            Id = Guid.NewGuid(),
            UserId = user.Id,
            Issuer = issuer,
            Subject = subject,
            ProviderId = provider.Id,
            CreatedAt = now,
        });
        SecurityEvents.Record(
            db, user.Id, SecurityEventKinds.IdentityLinked, context,
            string.IsNullOrWhiteSpace(provider.DisplayName) ? provider.Id : provider.DisplayName,
            await SecurityEvents.VerifiedEmailAsync(db, user.Id, cancellationToken));
        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (DatabaseErrors.IsUniqueConstraint(exception))
        {
            // Linked by a request that won the race.
            return "taken";
        }

        return "linked";
    }

    /// <summary>Sends a failed or cancelled sign-in back to the login page, saying roughly why.</summary>
    private static Task RedirectToLoginAsync(RemoteFailureContext context)
    {
        if (IdentityLinks.Recall(context.Properties) is not null)
        {
            var outcome = context.Request.Query["error"] == "access_denied" ? "cancelled" : "failed";
            context.Response.Redirect($"/link-account?result={outcome}");
            context.HandleResponse();
            return Task.CompletedTask;
        }

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
