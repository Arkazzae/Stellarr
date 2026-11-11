using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Auth;
using Stellarr.Api.Contracts;
using Stellarr.Api.Data;

namespace Stellarr.Api.Endpoints;

public static partial class CockpitEndpoints
{
    /// <summary>How many days the overview's activity chart covers, today included.</summary>
    internal const int ActivityDays = 30;

    /// <summary>
    /// What happened per day of the instance's time zone, oldest first and today
    /// last: messages, the people who wrote them, joins and reactions on the
    /// instance server, and uploads and sign-ins on the whole instance. The
    /// filters are the overview's, so the chart adds up to the totals on its cards.
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

        var messageRows = await db.Messages.AsNoTracking()
            .Where(x => x.CreatedAt >= since
                && db.Channels.Any(channel => channel.Id == x.ChannelId && channel.ServerId == server.Id))
            .Select(x => new { x.CreatedAt, x.AuthorId, x.IsSystem })
            .ToListAsync(cancellationToken);
        var joinTimes = await db.ServerMembers.AsNoTracking()
            .Where(x => x.ServerId == server.Id && x.JoinedAt >= since)
            .Select(x => x.JoinedAt)
            .ToListAsync(cancellationToken);
        var reactionTimes = await db.MessageReactions.AsNoTracking()
            .Where(x => x.CreatedAt >= since
                && db.Messages.Any(message => message.Id == x.MessageId
                    && db.Channels.Any(channel => channel.Id == message.ChannelId && channel.ServerId == server.Id)))
            .Select(x => x.CreatedAt)
            .ToListAsync(cancellationToken);
        var uploadTimes = await db.ImageAttachments.AsNoTracking()
            .Where(x => x.CreatedAt >= since)
            .Select(x => x.CreatedAt)
            .ToListAsync(cancellationToken);
        var signInTimes = await db.UserSessions.AsNoTracking()
            .Where(x => x.CreatedAt >= since)
            .Select(x => x.CreatedAt)
            .ToListAsync(cancellationToken);

        var messages = CountByLocalDay(messageRows.Select(x => x.CreatedAt), firstDay, ActivityDays, zone);
        // System messages have an author on record but nobody wrote them.
        var writers = CountPeopleByLocalDay(
            messageRows.Where(x => !x.IsSystem).Select(x => (x.CreatedAt, x.AuthorId)),
            firstDay,
            ActivityDays,
            zone);
        var joins = CountByLocalDay(joinTimes, firstDay, ActivityDays, zone);
        var reactions = CountByLocalDay(reactionTimes, firstDay, ActivityDays, zone);
        var uploads = CountByLocalDay(uploadTimes, firstDay, ActivityDays, zone);
        var signIns = CountByLocalDay(signInTimes, firstDay, ActivityDays, zone);
        var days = Enumerable.Range(0, ActivityDays)
            .Select(index => new CockpitActivityDayDto(
                firstDay.AddDays(index).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                messages[index],
                joins[index],
                writers.PerDay[index],
                reactions[index],
                uploads[index],
                signIns[index]))
            .ToArray();

        return Results.Ok(new CockpitActivityDto(zone.Id, days, writers.Total));
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
            var index = LocalDayIndex(instant, firstDay, zone);
            if (index >= 0 && index < days)
            {
                counts[index]++;
            }
        }

        return counts;
    }

    /// <summary>
    /// Counts the different people behind the events of each local day, and of
    /// the whole range, so someone active on three days counts once in the total.
    /// </summary>
    internal static (int[] PerDay, int Total) CountPeopleByLocalDay(
        IEnumerable<(DateTime UtcInstant, Guid Person)> events,
        DateOnly firstDay,
        int days,
        TimeZoneInfo zone)
    {
        var perDay = new HashSet<Guid>?[days];
        var everyone = new HashSet<Guid>();
        foreach (var (instant, person) in events)
        {
            var index = LocalDayIndex(instant, firstDay, zone);
            if (index >= 0 && index < days)
            {
                (perDay[index] ??= []).Add(person);
                everyone.Add(person);
            }
        }

        return ([.. perDay.Select(people => people?.Count ?? 0)], everyone.Count);
    }

    private static int LocalDayIndex(DateTime instant, DateOnly firstDay, TimeZoneInfo zone)
    {
        // SQLite hands timestamps back without a kind; they are stored in UTC.
        var local = TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(instant, DateTimeKind.Utc), zone);
        return DateOnly.FromDateTime(local).DayNumber - firstDay.DayNumber;
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
