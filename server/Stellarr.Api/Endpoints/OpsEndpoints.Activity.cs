using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Auth;
using Stellarr.Api.Contracts;
using Stellarr.Api.Data;

namespace Stellarr.Api.Endpoints;

public static partial class OpsEndpoints
{
    /// <summary>How many days the overview's activity chart covers, today included.</summary>
    internal const int ActivityDays = 30;

    /// <summary>
    /// Messages and joins on the instance server per day of the instance's time
    /// zone, oldest first and today last. The filters are the overview's, so the
    /// chart adds up to the totals on its cards.
    /// </summary>
    private static async Task<IResult> GetActivityAsync(
        HttpContext http,
        AppDbContext db,
        IConfiguration configuration,
        TimeProvider time,
        CancellationToken cancellationToken)
    {
        var server = http.RequireInstanceServer();
        var zoneId = await db.OperationsSettings.AsNoTracking()
            .Where(x => x.ServerId == server.Id)
            .Select(x => x.TimeZone)
            .SingleOrDefaultAsync(cancellationToken);
        var zone = FindTimeZone(zoneId ?? configuration["Operations:TimeZone"] ?? TimeZoneInfo.Local.Id);

        var now = time.GetUtcNow().UtcDateTime;
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(now, zone));
        var firstDay = today.AddDays(-(ActivityDays - 1));
        // One day more than the window covers the first local day in any zone;
        // the counting drops whatever falls before it.
        var since = now.AddDays(-(ActivityDays + 1));

        var messageTimes = await db.Messages.AsNoTracking()
            .Where(x => x.CreatedAt >= since
                && db.Channels.Any(channel => channel.Id == x.ChannelId && channel.ServerId == server.Id))
            .Select(x => x.CreatedAt)
            .ToListAsync(cancellationToken);
        var joinTimes = await db.ServerMembers.AsNoTracking()
            .Where(x => x.ServerId == server.Id && x.JoinedAt >= since)
            .Select(x => x.JoinedAt)
            .ToListAsync(cancellationToken);

        var messages = CountByLocalDay(messageTimes, firstDay, ActivityDays, zone);
        var joins = CountByLocalDay(joinTimes, firstDay, ActivityDays, zone);
        var days = Enumerable.Range(0, ActivityDays)
            .Select(index => new OpsActivityDayDto(
                firstDay.AddDays(index).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                messages[index],
                joins[index]))
            .ToArray();

        return Results.Ok(new OpsActivityDto(zone.Id, days));
    }

    /// <summary>
    /// Counts UTC instants by the calendar day they fall on in <paramref name="zone"/>,
    /// for <paramref name="days"/> days from <paramref name="firstDay"/>. Instants
    /// outside that range are not counted.
    /// </summary>
    internal static int[] CountByLocalDay(
        IEnumerable<DateTime> utcInstants,
        DateOnly firstDay,
        int days,
        TimeZoneInfo zone)
    {
        var counts = new int[days];
        foreach (var instant in utcInstants)
        {
            // SQLite hands timestamps back without a kind; they are stored in UTC.
            var local = TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(instant, DateTimeKind.Utc), zone);
            var index = DateOnly.FromDateTime(local).DayNumber - firstDay.DayNumber;
            if (index >= 0 && index < days)
            {
                counts[index]++;
            }
        }

        return counts;
    }

    /// <summary>The named zone, or UTC when the name is empty or unknown to this host.</summary>
    private static TimeZoneInfo FindTimeZone(string? id)
    {
        if (!string.IsNullOrWhiteSpace(id))
        {
            try
            {
                return TimeZoneInfo.FindSystemTimeZoneById(id.Trim());
            }
            catch (TimeZoneNotFoundException)
            {
            }
            catch (InvalidTimeZoneException)
            {
            }
        }

        return TimeZoneInfo.Utc;
    }
}
