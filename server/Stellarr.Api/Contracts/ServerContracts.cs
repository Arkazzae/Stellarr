namespace Stellarr.Api.Contracts;

public sealed record RegisterRequest(
    string Username,
    string DisplayName,
    string Email,
    string Password,
    string? InviteCode = null);
