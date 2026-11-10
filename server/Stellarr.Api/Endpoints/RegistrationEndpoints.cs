using System.Net.Mail;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Auth;
using Stellarr.Api.Contracts;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;
using Stellarr.Api.Realtime;

namespace Stellarr.Api.Endpoints;

/// <summary>
/// Creates accounts. The first one makes the instance: a server, its two
/// roles and channels, and an owner. Every later one needs the code of an
/// invite and joins the server that invite belongs to.
/// </summary>
public static partial class RegistrationEndpoints
{
    private const int PasswordMinLength = 8;
    private const int PasswordMaxLength = 256;

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
        IHubContext<AppHub> hub,
        HttpContext context,
        CancellationToken cancellationToken)
    {
        var problems = Validate(request);
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

        var taken = await FindTakenAsync(db, normalizedUsername, normalizedEmail, cancellationToken);
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
                return InviteProblem("Zaproszenie wygasło, osiągnęło limit użyć albo jest nieprawidłowe.");
            }
        }

        var server = invite is null
            ? await db.Servers.OrderBy(x => x.CreatedAt).ThenBy(x => x.Id).FirstOrDefaultAsync(cancellationToken)
            : await db.Servers.FindAsync([invite.ServerId], cancellationToken);
        if (invite is null && server is not null)
        {
            return InviteProblem("Do utworzenia konta na istniejącej instancji wymagane jest zaproszenie.");
        }

        if (invite is not null && server is null)
        {
            return InviteProblem("Serwer wskazany przez zaproszenie już nie istnieje.");
        }

        ServerRole role;
        if (server is null)
        {
            (server, role) = AddInstance(db, now);
        }
        else if (await FindNewMemberRoleAsync(db, server.Id, cancellationToken) is { } memberRole)
        {
            role = memberRole;
        }
        else
        {
            return Results.Problem(
                statusCode: StatusCodes.Status503ServiceUnavailable,
                title: "Instancja nie ma roli dla nowych użytkowników.");
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
        var welcome = await ServerWelcome.CreateAsync(db, server.Id, user, now, cancellationToken);
        if (invite is not null)
        {
            invite.Uses++;
        }

        var session = SessionAuthentication.CreateSession(context, id);
        db.UserSessions.Add(session);

        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (DatabaseErrors.IsUniqueConstraint(exception))
        {
            // Somebody else wrote the same username or address after our check:
            // answer as the check would have, not with a server error.
            db.ChangeTracker.Clear();
            taken = await FindTakenAsync(db, normalizedUsername, normalizedEmail, cancellationToken);
            if (taken.Count > 0)
            {
                return Results.ValidationProblem(taken);
            }

            throw;
        }

        await SessionAuthentication.SignInAsync(context, user, session.Id);
        await ServerWelcome.PublishAsync(hub, server.Id, welcome, CancellationToken.None);
        return Results.Created("/api/me", user.ToDto("online"));
    }

    private static Dictionary<string, string[]> Validate(RegisterRequest request)
    {
        var errors = new Dictionary<string, string[]>(StringComparer.Ordinal);
        var password = request.Password;
        if (password is null || password.Length < PasswordMinLength)
        {
            errors["password"] = [$"Hasło musi mieć co najmniej {PasswordMinLength} znaków."];
        }
        else if (password.Length > PasswordMaxLength)
        {
            errors["password"] = [$"Hasło może mieć najwyżej {PasswordMaxLength} znaków."];
        }

        var username = request.Username?.Trim() ?? "";
        if (username.Length is < 3 or > 32 || !UsernameShape().IsMatch(username))
        {
            errors["username"] = ["Nazwa użytkownika musi mieć 3–32 znaki: litery, cyfry, kropkę, myślnik lub podkreślenie."];
        }

        var displayName = request.DisplayName?.Trim() ?? "";
        if (displayName.Length is < 1 or > 64)
        {
            errors["displayName"] = ["Nazwa widoczna musi mieć od 1 do 64 znaków."];
        }

        var email = request.Email?.Trim() ?? "";
        if (email.Length > 320 ||
            !MailAddress.TryCreate(email, out var address) ||
            !string.Equals(address.Address, email, StringComparison.OrdinalIgnoreCase))
        {
            errors["email"] = ["Podaj poprawny adres e-mail."];
        }

        return errors;
    }

    private static async Task<Dictionary<string, string[]>> FindTakenAsync(
        AppDbContext db,
        string normalizedUsername,
        string normalizedEmail,
        CancellationToken cancellationToken)
    {
        var existing = await db.Users.AsNoTracking()
            .Where(x => x.NormalizedUsername == normalizedUsername || x.NormalizedEmail == normalizedEmail)
            .Select(x => new { x.NormalizedUsername, x.NormalizedEmail })
            .ToArrayAsync(cancellationToken);

        var errors = new Dictionary<string, string[]>(StringComparer.Ordinal);
        if (existing.Any(x => x.NormalizedUsername == normalizedUsername))
        {
            errors["username"] = ["Ta nazwa użytkownika jest już zajęta."];
        }

        if (existing.Any(x => x.NormalizedEmail == normalizedEmail))
        {
            errors["email"] = ["Konto z tym adresem e-mail już istnieje."];
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

    /// <summary>The role people get when they join: the system role below the owner's that ranks last.</summary>
    private static async Task<ServerRole?> FindNewMemberRoleAsync(
        AppDbContext db,
        Guid serverId,
        CancellationToken cancellationToken) =>
        await db.ServerRoles
            .Where(x => x.ServerId == serverId && x.IsSystem && !x.IsOwner)
            .OrderByDescending(x => x.Position)
            .FirstOrDefaultAsync(cancellationToken);

    /// <summary>Stages the first server with its roles, channels and settings; the registering account will own it.</summary>
    private static (StellarrServer Server, ServerRole OwnerRole) AddInstance(AppDbContext db, DateTime now)
    {
        var server = new StellarrServer { Id = Guid.NewGuid(), Name = "Stellarr", CreatedAt = now };
        var ownerRole = new ServerRole
        {
            Id = Guid.NewGuid(),
            ServerId = server.Id,
            Name = "Właściciel",
            Color = "oklch(0.72 0.16 15)",
            Permissions = ServerPrivileges.All,
            Position = 0,
            IsSystem = true,
            IsOwner = true,
        };
        var memberRole = new ServerRole
        {
            Id = Guid.NewGuid(),
            ServerId = server.Id,
            Name = "Członek",
            Color = "oklch(0.70 0.02 277)",
            Permissions = ServerPrivileges.None,
            Position = 1,
            IsSystem = true,
        };

        db.Servers.Add(server);
        db.ServerRoles.AddRange(ownerRole, memberRole);
        db.Channels.AddRange(
            new Channel { Id = Guid.NewGuid(), ServerId = server.Id, Name = "ogólny", Kind = ChannelKind.Text, Position = 0 },
            new Channel { Id = Guid.NewGuid(), ServerId = server.Id, Name = "rozmowa", Kind = ChannelKind.Voice, Position = 1 });
        db.ServerAdminSettings.Add(new ServerAdminSettings { ServerId = server.Id });
        return (server, ownerRole);
    }
}
