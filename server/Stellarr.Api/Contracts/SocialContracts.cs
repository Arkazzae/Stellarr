using Stellarr.Api.Domain;

namespace Stellarr.Api.Contracts;

/// <param name="Username">With or without a leading "@"; a null is answered like an empty name.</param>
public sealed record CreateFriendRequestRequest(string? Username);

public sealed record FriendDto(UserDto User, DateTime Since);

/// <param name="User">The other person, whichever way the request points.</param>
/// <param name="Direction">"incoming" when the viewer may answer it, "outgoing" when they sent it.</param>
public sealed record FriendRequestDto(string Id, UserDto User, string Direction, DateTime SentAt);

/// <param name="LastMessage">Null while nobody has written.</param>
/// <param name="Unread">Messages of the peer after the viewer's read marker.</param>
/// <param name="UpdatedAt">The last message's time, or the conversation's own while it is empty.</param>
public sealed record DirectConversationDto(
    string Id,
    UserDto Peer,
    MessageDto? LastMessage,
    int Unread,
    DateTime UpdatedAt);

/// <param name="Blocked">Only the people the viewer blocked, not those who blocked the viewer.</param>
public sealed record SocialStateDto(
    IReadOnlyList<FriendDto> Friends,
    IReadOnlyList<FriendRequestDto> Requests,
    IReadOnlyList<UserDto> Blocked,
    IReadOnlyList<DirectConversationDto> Conversations);

/// <param name="Result">
/// "sent", "already-sent", "already-friends", "blocked", "self" or "unknown-user".
/// </param>
public sealed record FriendRequestResultDto(string Result);

public static class SocialContractMappings
{
    /// <remarks>The message's author and attachments must be loaded.</remarks>
    public static MessageDto ToDto(this DirectMessage message) => new(
        message.Id.ToString(),
        message.ConversationId.ToString(),
        message.Author.ToDto("online"),
        message.Content,
        message.CreatedAt.AsUtc(),
        message.Attachments.Select(x => x.Attachment.ToDto()).ToArray(),
        [],
        null);
}
