using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;

namespace Stellarr.Api.Auth.Security;

public static class RecoveryCodes
{
    public const int Count = 10;
    private const int Groups = 4;
    private const int GroupLength = 7;

    public static async Task<IReadOnlyList<string>> RegenerateAsync(
        AppDbContext db,
        Guid userId,
        DateTime now,
        CancellationToken cancellationToken)
    {
        await db.RecoveryCodes
            .Where(x => x.UserId == userId && x.UsedAt == null)
            .ExecuteUpdateAsync(setters => setters.SetProperty(x => x.UsedAt, now), cancellationToken);

        var batchId = Guid.NewGuid();
        var codes = new string[Count];
        for (var index = 0; index < codes.Length; index++)
        {
            var code = string.Join(
                "-",
                Enumerable.Range(0, Groups).Select(_ => SecurityTokens.RandomText(GroupLength)));
            codes[index] = code;
            db.RecoveryCodes.Add(new RecoveryCode
            {
                Id = Guid.NewGuid(),
                UserId = userId,
                BatchId = batchId,
                CodeHash = SecurityTokens.Hash(Normalize(code)),
                CreatedAt = now,
            });
        }

        return codes;
    }

    /// <summary>A conditional update, so one code can be spent at most once even under a race.</summary>
    public static async Task<bool> ConsumeAsync(
        AppDbContext db,
        Guid userId,
        string code,
        DateTime now,
        CancellationToken cancellationToken)
    {
        var normalized = Normalize(code);
        if (normalized.Length == 0)
        {
            return false;
        }

        var changed = await db.RecoveryCodes
            .Where(x => x.UserId == userId &&
                x.CodeHash == SecurityTokens.Hash(normalized) &&
                x.UsedAt == null)
            .ExecuteUpdateAsync(setters => setters.SetProperty(x => x.UsedAt, now), cancellationToken);
        return changed == 1;
    }

    public static Task<int> RemainingAsync(
        AppDbContext db,
        Guid userId,
        CancellationToken cancellationToken) =>
        db.RecoveryCodes.CountAsync(x => x.UserId == userId && x.UsedAt == null, cancellationToken);

    /// <summary>First enrollment gets codes; adding another method leaves an existing set alone.</summary>
    public static async Task<IReadOnlyList<string>?> RegenerateIfMissingAsync(
        AppDbContext db,
        Guid userId,
        CancellationToken cancellationToken) =>
        await RemainingAsync(db, userId, cancellationToken) > 0
            ? null
            : await RegenerateAsync(db, userId, DateTime.UtcNow, cancellationToken);

    private static string Normalize(string code) =>
        new(code.Where(character => char.IsAsciiLetterOrDigit(character)).Select(char.ToUpperInvariant).ToArray());
}
