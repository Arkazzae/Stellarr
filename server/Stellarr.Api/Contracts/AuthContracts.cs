using Stellarr.Api.Domain;

namespace Stellarr.Api.Contracts;

public sealed record LoginRequest(string Username, string Password);

public sealed record DesktopBrowserExchangeRequest(string RequestId, string Secret);

public sealed record SessionDto(UserDto? User);

public sealed record UserDto(
    string Id,
    string Username,
    string DisplayName,
    string AvatarColor,
    string Presence,
    // The profile, all optional. A client that predates these fields ignores
    // them; the web client treats null as "no upload" and selects a matching
    // built-in avatar/banner pair from the person's stable id.
    string? AvatarUrl = null,
    string? BannerUrl = null,
    string? CustomStatus = null,
    string? Bio = null,
    string? Pronouns = null);

public static class AuthContractMappings
{
    public static UserDto ToDto(this User user, string presence = "offline") => new(
        user.Id.ToString(),
        user.Username,
        user.DisplayName,
        user.AvatarColor,
        presence,
        user.AvatarUrl,
        user.BannerUrl,
        user.CustomStatus,
        user.Bio,
        user.Pronouns);
}
