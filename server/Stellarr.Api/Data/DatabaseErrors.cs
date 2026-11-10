using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

namespace Stellarr.Api.Data;

public static class DatabaseErrors
{
    private const int ConstraintError = 19;
    private const int PrimaryKeyViolation = 1_555;
    private const int UniqueViolation = 2_067;

    /// <summary>
    /// Whether a save failed because a row with the same key or the same
    /// unique value already exists, which is how a lost race shows up.
    /// </summary>
    public static bool IsUniqueConstraint(DbUpdateException exception) =>
        exception.GetBaseException() is SqliteException
        {
            SqliteErrorCode: ConstraintError,
            SqliteExtendedErrorCode: PrimaryKeyViolation or UniqueViolation,
        };

    /// <summary>
    /// Saves, and says false when a unique value was taken by another request
    /// after this one had checked that it was free. The pending changes are
    /// dropped then, so the context holds nothing the caller did not mean to keep.
    /// </summary>
    public static async Task<bool> TrySaveChangesAsync(this DbContext db, CancellationToken cancellationToken)
    {
        try
        {
            await db.SaveChangesAsync(cancellationToken);
            return true;
        }
        catch (DbUpdateException exception) when (IsUniqueConstraint(exception))
        {
            db.ChangeTracker.Clear();
            return false;
        }
    }
}
