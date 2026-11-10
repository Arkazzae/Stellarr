using Microsoft.EntityFrameworkCore;

namespace Stellarr.Api.Data.Schema;

/// <summary>Helpers the schema steps of older installations share.</summary>
internal static class SqliteSchema
{
    /// <summary>
    /// SQLite has no ADD COLUMN IF NOT EXISTS, so a step asks the table's own
    /// description first. Only the question lives here: the ALTER stays a
    /// constant statement of the step, so that no SQL is ever built from names.
    /// </summary>
    internal static async Task<bool> HasColumnAsync(
        AppDbContext db,
        string table,
        string column,
        CancellationToken cancellationToken) =>
        await db.Database
            .SqlQuery<int>($"""SELECT COUNT(*) AS "Value" FROM pragma_table_info({table}) WHERE "name" = {column}""")
            .SingleAsync(cancellationToken) > 0;
}
