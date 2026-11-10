using Stellarr.Api.Domain;

namespace Stellarr.Api.Contracts;

public sealed record RegisterRequest(
    string Username,
    string DisplayName,
    string Email,
    string Password,
    string? InviteCode = null);

public sealed record ServerDto(
    string Id,
    string Name,
    string Description,
    string? IconUrl,
    DateTime CreatedAt,
    bool IsPublic);

public sealed record ChannelDto(
    string Id,
    string Name,
    string Kind,
    int Position,
    string Topic,
    int SlowModeSeconds,
    int HideAfterInactivityHours,
    string AudioProfile,
    int UserLimit,
    string? SectionId);

public sealed record SectionDto(string Id, string Name, int Position);

public static class ServerContractMappings
{
    public static ServerDto ToDto(this StellarrServer server) => new(
        server.Id.ToString(),
        server.Name,
        server.Description,
        server.IconUrl,
        server.CreatedAt.AsUtc(),
        server.IsPublic);

    public static ChannelDto ToDto(this Channel channel) => new(
        channel.Id.ToString(),
        channel.Name,
        channel.Kind == ChannelKind.Text ? "text" : "voice",
        channel.Position,
        channel.Topic,
        channel.SlowModeSeconds,
        channel.HideAfterInactivityHours,
        channel.AudioProfile,
        channel.UserLimit,
        channel.SectionId?.ToString());

    public static SectionDto ToDto(this Section section) => new(
        section.Id.ToString(),
        section.Name,
        section.Position);
}
