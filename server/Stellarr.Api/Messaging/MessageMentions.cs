using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Contracts;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;
using Stellarr.Api.Realtime;

namespace Stellarr.Api.Messaging;

/// <summary>
/// Turns <c>@username</c> in a message into entries in the inbox of the
/// members it names, so that a mention is more than styling. What the web
/// renderer does not style is not a mention either: code and links.
/// </summary>
internal static class MessageMentions
{
    internal const string PackageId = "stellarr.mention";

    private const int MinNameLength = 2;
    private const int MaxNameLength = 32;
    private const int PreviewLength = 220;

    /// <summary>
    /// Adds an inbox entry for each member of the server the message names,
    /// except its author, to the context. The caller saves them with the
    /// message and announces them afterwards.
    /// </summary>
    internal static async Task<IReadOnlyList<UserNotification>> AddNotificationsAsync(
        AppDbContext db,
        Guid serverId,
        Message message,
        CancellationToken cancellationToken)
    {
        var names = ExtractNormalizedUsernames(message.Content);
        if (names.Count == 0)
        {
            return [];
        }

        var recipients = await db.ServerMembers.AsNoTracking()
            .Where(member => member.ServerId == serverId &&
                member.UserId != message.AuthorId &&
                names.Contains(member.User.NormalizedUsername))
            .Select(member => member.UserId)
            .Distinct()
            .ToArrayAsync(cancellationToken);
        if (recipients.Length == 0)
        {
            return [];
        }

        var author = message.Author.DisplayName;
        var preview = Preview(message.Content);
        var notifications = recipients.Select(userId => new UserNotification
        {
            Id = Guid.NewGuid(),
            ServerId = serverId,
            UserId = userId,
            Source = "system",
            SourcePackageId = PackageId,
            SourcePackageName = "Stellarr",
            SourceModuleId = "mention",
            SourceModuleName = author,
            Title = $"{author} mentioned you",
            Body = preview,
            Tone = "info",
            TargetChannelId = message.ChannelId,
            CreatedAt = message.CreatedAt,
        }).ToArray();
        db.UserNotifications.AddRange(notifications);
        return notifications;
    }

    /// <summary>Tells each recipient's connections that their inbox has a new entry.</summary>
    internal static Task FanOutAsync(
        IHubContext<AppHub> hub,
        IReadOnlyList<UserNotification> notifications,
        CancellationToken cancellationToken) =>
        Task.WhenAll(notifications.Select(notification => hub.Clients
            .Group(AppHub.UserGroup(notification.UserId))
            .SendAsync(
                "NotificationInboxChanged",
                new NotificationInboxChangedDto(notification.ServerId.ToString(), notification.Sequence, Global: false),
                cancellationToken)));

    /// <summary>
    /// The upper-cased names mentioned in <paramref name="content"/>. A name
    /// starts at an <c>@</c> that no name character precedes, so an e-mail
    /// address is not one, and runs for at most 32 name characters.
    /// </summary>
    internal static HashSet<string> ExtractNormalizedUsernames(string content)
    {
        var names = new HashSet<string>(StringComparer.Ordinal);
        var text = content.AsSpan();
        var index = 0;
        while (index < text.Length)
        {
            var rest = text[index..];
            if (rest.StartsWith("```", StringComparison.Ordinal))
            {
                index = AfterClosing(text, index + 3, "```", StringComparison.Ordinal);
            }
            else if (rest[0] == '`')
            {
                index = AfterClosing(text, index + 1, "`", StringComparison.Ordinal);
            }
            else if (rest.StartsWith("<code>", StringComparison.OrdinalIgnoreCase))
            {
                index = AfterClosing(text, index + 6, "</code>", StringComparison.OrdinalIgnoreCase);
            }
            else if (rest.StartsWith("http://", StringComparison.OrdinalIgnoreCase) ||
                rest.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
            {
                index = EndOfWord(text, index);
            }
            else if (rest[0] == '@' && (index == 0 || !IsNameCharacter(text[index - 1])))
            {
                var end = index + 1;
                while (end < text.Length && end - index - 1 < MaxNameLength && IsNameCharacter(text[end]))
                {
                    end++;
                }

                if (end - index - 1 >= MinNameLength)
                {
                    names.Add(text[(index + 1)..end].ToString().ToUpperInvariant());
                }

                index = end;
            }
            else
            {
                index++;
            }
        }

        return names;
    }

    /// <summary>Where scanning resumes after a span that ends at <paramref name="closing"/>, or at the end of the text if it never closes.</summary>
    private static int AfterClosing(ReadOnlySpan<char> text, int from, string closing, StringComparison comparison)
    {
        var offset = text[from..].IndexOf(closing, comparison);
        return offset < 0 ? text.Length : from + offset + closing.Length;
    }

    private static int EndOfWord(ReadOnlySpan<char> text, int from)
    {
        var end = from;
        while (end < text.Length && !char.IsWhiteSpace(text[end]))
        {
            end++;
        }

        return end;
    }

    private static bool IsNameCharacter(char value) =>
        char.IsLetterOrDigit(value) || value is '_' or '.' or '-';

    private static string Preview(string content)
    {
        var compact = string.Join(' ', content.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
        return compact.Length <= PreviewLength ? compact : $"{compact[..(PreviewLength - 3)]}…";
    }
}
