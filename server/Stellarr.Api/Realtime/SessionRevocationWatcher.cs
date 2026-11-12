using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Auth;
using Stellarr.Api.Auth.Security;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;

namespace Stellarr.Api.Realtime;

/// <summary>
/// Rejects hub connections whose durable session changed outside this request,
/// including changes made by the operator CLI in another process. Polling is
/// bounded to one second and reads only the sessions that have a live socket.
/// </summary>
public sealed class SessionRevocationWatcher(
    IServiceProvider services,
    HubConnectionRegistry registry,
    ILogger<SessionRevocationWatcher> logger) : BackgroundService
{
    private static readonly Action<ILogger, string, Exception?> SweepFailed = LoggerMessage.Define<string>(
        LogLevel.Warning,
        new EventId(1, "SessionRevocationSweepFailed"),
        "Checking revoked realtime sessions failed: {Type}");

    private static readonly Action<ILogger, Exception?> AlreadyEnded = LoggerMessage.Define(
        LogLevel.Debug,
        new EventId(2, "HubConnectionAlreadyEnded"),
        "A hub connection had already ended before it could be aborted.");

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (services.GetService<IHostEnvironment>()?.EnvironmentName == "Testing")
        {
            // Tests drive the watcher directly, so its timer cannot race them.
            return;
        }

        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(1));
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await SweepAsync(DateTime.UtcNow, stoppingToken);
            }
            catch (Exception exception) when (exception is not OperationCanceledException)
            {
                SweepFailed(logger, exception.GetType().Name, exception);
            }

            try
            {
                await timer.WaitForNextTickAsync(stoppingToken);
            }
            catch (OperationCanceledException)
            {
                return;
            }
        }
    }

    /// <summary>One pass, exposed so tests can run it deterministically.</summary>
    public async Task SweepAsync(DateTime utcNow, CancellationToken cancellationToken)
    {
        var connections = registry.Snapshot();
        if (connections.Count == 0)
        {
            return;
        }

        await using var scope = services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var sessionIds = connections.Select(x => x.SessionId).Distinct().ToArray();
        var sessions = await db.UserSessions.AsNoTracking()
            .Where(x => sessionIds.Contains(x.Id))
            .Select(x => new
            {
                x.Id,
                x.UserId,
                x.RevokedAt,
                x.ExpiresAt,
                x.AbsoluteExpiresAt,
                x.CreatedAt,
                x.SecurityVersion,
                x.MfaCompletedAt,
                x.MfaEvidence,
                UserIsDisabled = x.User.IsDisabled,
                UserSessionVersion = x.User.SessionVersion,
            })
            .ToArrayAsync(cancellationToken);
        var byId = sessions.ToDictionary(x => x.Id);

        var policy = await MfaPolicy.LoadAsync(db, cancellationToken);
        var requirementByUser = new Dictionary<Guid, bool>();
        foreach (var connection in connections)
        {
            if (!byId.TryGetValue(connection.SessionId, out var session) ||
                session.UserId != connection.UserId ||
                session.RevokedAt is not null ||
                session.UserIsDisabled ||
                session.ExpiresAt <= utcNow ||
                (session.AbsoluteExpiresAt ?? session.CreatedAt.Add(SessionAuthentication.Lifetime)) <= utcNow ||
                session.SecurityVersion != session.UserSessionVersion ||
                connection.SecurityVersion != session.UserSessionVersion)
            {
                Abort(connection);
                continue;
            }

            if (policy.MfaRequirement == MfaRequirements.Optional)
            {
                continue;
            }

            if (!requirementByUser.TryGetValue(connection.UserId, out var required))
            {
                required = await MfaPolicy.IsRequiredAtLoginAsync(
                    db, policy, connection.UserId, cancellationToken);
                requirementByUser[connection.UserId] = required;
            }

            if (required && !MfaPolicy.IsSatisfied(
                    session.MfaCompletedAt is not null,
                    session.MfaEvidence,
                    policy.MfaRequirement))
            {
                Abort(connection);
            }
        }
    }

    private void Abort(LiveHubConnection connection)
    {
        try
        {
            connection.Abort();
        }
        catch (Exception exception) when (exception is ObjectDisposedException or InvalidOperationException)
        {
            AlreadyEnded(logger, exception);
        }
    }
}
