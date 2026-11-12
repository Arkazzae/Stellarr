using System.Net.Mail;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Auth;
using Stellarr.Api.Auth.Security;
using Stellarr.Api.Contracts;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;
using Stellarr.Api.Localization;
using Stellarr.Api.Realtime;

namespace Stellarr.Api.Endpoints;

/// <summary>
/// Creates accounts. The first one makes the instance: a server, its two
/// roles and channels, and an owner. Every later one needs the code of an
/// invite and joins the server that invite belongs to.
/// </summary>
public static partial class RegistrationEndpoints
{
    [GeneratedRegex(@"^[\p{L}\p{N}_.-]+$", RegexOptions.CultureInvariant)]
    private static partial Regex UsernameShape();

    public static IEndpointRouteBuilder MapRegistrationEndpoints(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapPost("/api/auth/register", RegisterAsync).RequireRateLimiting(RateLimitPolicies.AuthWrite);
        return endpoints;
    }

    private static async Task<IResult> RegisterAsync(
        RegisterRequest request,
        AppDbContext db,
        PasswordService passwords,
        RegistrationGate gate,
        Messages messages,
        IHubContext<AppHub> hub,
        HttpContext context,
        CancellationToken cancellationToken)
    {
        var problems = Validate(request, messages);
        if (problems.Count > 0)
        {
            return Results.ValidationProblem(problems);
        }

        var username = request.Username.Trim();
        var email = request.Email.Trim();
        var normalizedUsername = username.ToUpperInvariant();
        var normalizedEmail = email.ToUpperInvariant();

        // Whether the instance is still empty is read and acted on inside one
        // critical section, so two first registrations cannot both found it.
        await using var turn = await gate.EnterAsync(cancellationToken);

        var taken = await FindTakenAsync(db, normalizedUsername, normalizedEmail, messages, cancellationToken);
        if (taken.Count > 0)
        {
            return Results.ValidationProblem(taken);
        }

        var now = DateTime.UtcNow;
        ServerInvite? invite = null;
        if (!string.IsNullOrWhiteSpace(request.InviteCode))
        {
            invite = await FindUsableInviteAsync(db, request.InviteCode, now, cancellationToken);
            if (invite is null)
            {
                return InviteProblem(messages.Get(MessageKey.InviteUnusable));
            }
        }

        var server = invite is null
            ? await db.Servers.OrderBy(x => x.CreatedAt).ThenBy(x => x.Id).FirstOrDefaultAsync(cancellationToken)
            : await db.Servers.FindAsync([invite.ServerId], cancellationToken);
        if (invite is null && server is not null)
        {
            return InviteProblem(messages.Get(MessageKey.InviteRequired));
        }

        if (invite is not null && server is null)
        {
            return InviteProblem(messages.Get(MessageKey.InviteServerGone));
        }

        ServerRole role;
        if (server is null)
        {
            var starter = new ServerDirectoryEndpoints.StarterServer(
                "Stellarr",
                messages.Get(MessageKey.DefaultTextChannelName),
                messages.Get(MessageKey.DefaultVoiceChannelName));
            (server, role) = ServerDirectoryEndpoints.AddServer(db, starter, messages, now);
        }
        else if (await ServerAccess.FindMemberRoleAsync(db, server.Id, cancellationToken) is { } memberRole)
        {
            role = memberRole;
        }
        else
        {
            return Results.Problem(
                statusCode: StatusCodes.Status503ServiceUnavailable,
                title: messages.Get(MessageKey.InstanceHasNoMemberRole));
        }

        var id = Guid.NewGuid();
        var user = new User
        {
            Id = id,
            Username = username,
            NormalizedUsername = normalizedUsername,
            DisplayName = request.DisplayName.Trim(),
            Email = email,
            NormalizedEmail = normalizedEmail,
            PasswordHash = passwords.Hash(request.Password),
            AvatarColor = $"oklch(0.58 0.14 {(uint)id.GetHashCode() % 360})",
            CreatedAt = now,
        };
        db.Users.Add(user);
        db.ServerMembers.Add(new ServerMember
        {
            ServerId = server.Id,
            UserId = id,
            RoleId = role.Id,
            OwnerSlot = role.IsOwner ? 1 : null,
            JoinedAt = now,
        });
        var welcome = await ServerWelcome.CreateAsync(db, server.Id, user, now, messages, cancellationToken);
        if (invite is not null)
        {
            invite.Uses++;
        }

        // The first owner cannot skip an instance-wide requirement by
        // registering: the decision is made against the role just assigned.
        var policy = await MfaPolicy.LoadAsync(db, cancellationToken);
        bool? required = policy.MfaRequirement switch
        {
            MfaRequirements.Everyone => true,
            MfaRequirements.Admins => role.IsOwner ||
                (role.Permissions & ServerPrivileges.ManageServer) == ServerPrivileges.ManageServer,
            _ => null,
        };
        var start = await AuthenticationFlow.StartAsync(
            db, context, user, "registration", policy, messages, cancellationToken, required);
        if (start.Session is { } session)
        {
            db.UserSessions.Add(session);
        }

        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (DatabaseErrors.IsUniqueConstraint(exception))
        {
            // Somebody else wrote the same username or address after our check:
            // answer as the check would have, not with a server error.
            db.ChangeTracker.Clear();
            taken = await FindTakenAsync(db, normalizedUsername, normalizedEmail, messages, cancellationToken);
            if (taken.Count > 0)
            {
                return Results.ValidationProblem(taken);
            }

            throw;
        }

        await ServerWelcome.PublishAsync(hub, server.Id, welcome, messages, CancellationToken.None);
        if (start.Session is not null)
        {
            await SessionAuthentication.SignInAsync(context, user, start.Session.Id);
            return Results.Created("/api/me", user.ToDto("online"));
        }

        return Results.Created("/api/me", start.Challenge);
    }

    private static Dictionary<string, string[]> Validate(RegisterRequest request, Messages messages)
    {
        var errors = new Dictionary<string, string[]>(StringComparer.Ordinal);
        if (PasswordPolicy.Violation(request.Password, messages) is { } passwordProblem)
        {
            errors["password"] = [passwordProblem];
        }

        var username = request.Username?.Trim() ?? "";
        if (username.Length is < 3 or > 32 || !UsernameShape().IsMatch(username))
        {
            errors["username"] = [messages.Get(MessageKey.UsernameInvalid)];
        }

        var displayName = request.DisplayName?.Trim() ?? "";
        if (displayName.Length is < 1 or > 64)
        {
            errors["displayName"] = [messages.Get(MessageKey.RegistrationDisplayNameLength)];
        }

        var email = request.Email?.Trim() ?? "";
        if (email.Length > 320 ||
            !MailAddress.TryCreate(email, out var address) ||
            !string.Equals(address.Address, email, StringComparison.OrdinalIgnoreCase))
        {
            errors["email"] = [messages.Get(MessageKey.EmailInvalid)];
        }

        return errors;
    }

    private static async Task<Dictionary<string, string[]>> FindTakenAsync(
        AppDbContext db,
        string normalizedUsername,
        string normalizedEmail,
        Messages messages,
        CancellationToken cancellationToken)
    {
        var existing = await db.Users.AsNoTracking()
            .Where(x => x.NormalizedUsername == normalizedUsername || x.NormalizedEmail == normalizedEmail)
            .Select(x => new { x.NormalizedUsername, x.NormalizedEmail })
            .ToArrayAsync(cancellationToken);

        var errors = new Dictionary<string, string[]>(StringComparer.Ordinal);
        if (existing.Any(x => x.NormalizedUsername == normalizedUsername))
        {
            errors["username"] = [messages.Get(MessageKey.UsernameTaken)];
        }

        if (existing.Any(x => x.NormalizedEmail == normalizedEmail))
        {
            errors["email"] = [messages.Get(MessageKey.EmailTaken)];
        }

        return errors;
    }

    /// <summary>The invite behind the code, or null when there is none or it has expired or run out.</summary>
    private static async Task<ServerInvite?> FindUsableInviteAsync(
        AppDbContext db,
        string code,
        DateTime now,
        CancellationToken cancellationToken)
    {
        var normalized = code.Trim().ToLowerInvariant();
        var invite = await db.ServerInvites.FirstOrDefaultAsync(x => x.Code == normalized, cancellationToken);
        return invite is null || invite.ExpiresAt <= now || invite.MaxUses <= invite.Uses ? null : invite;
    }

    private static IResult InviteProblem(string message) =>
        Results.ValidationProblem(new Dictionary<string, string[]> { ["inviteCode"] = [message] });
}
