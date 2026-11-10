using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Data.Schema;

namespace Stellarr.Api.Data;

/// <summary>
/// Creates the SQLite schema of a new installation and brings a database
/// written by an older build up to date.
/// </summary>
public static class DatabaseSchema
{
    /// <summary>
    /// Each step is idempotent and runs on every start, including on a database
    /// that <see cref="UpgradeAsync"/> created a moment earlier. On a new
    /// database the model has already produced every table, column and index it
    /// can express, so a step there only adds what the model cannot: triggers
    /// and virtual tables.
    /// </summary>
    private static readonly Func<AppDbContext, CancellationToken, Task>[] Steps =
    [
        AuthenticationSchema.UpgradeAsync,
    ];

    public static async Task UpgradeAsync(AppDbContext db, CancellationToken cancellationToken)
    {
        await db.Database.EnsureCreatedAsync(cancellationToken);
        await db.Database.ExecuteSqlRawAsync("PRAGMA journal_mode=WAL;", cancellationToken);
        await db.Database.ExecuteSqlRawAsync("PRAGMA foreign_keys=ON;", cancellationToken);
        await db.Database.ExecuteSqlRawAsync("PRAGMA busy_timeout=5000;", cancellationToken);

        foreach (var step in Steps)
        {
            await step(db, cancellationToken);
        }
    }
}
