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
}
