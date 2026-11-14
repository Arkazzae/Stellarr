namespace Stellarr.Api.Storage;

/// <summary>What an object key may look like.</summary>
public static class ObjectKeys
{
    /// <summary>
    /// A relative path of plain segments separated by <c>/</c>: no absolute
    /// path, no backslash, no NUL, no empty segment and no step up or in
    /// place. Such a key stays inside any folder it is joined to, which the
    /// file store and an unpacked backup both rely on.
    /// </summary>
    public static bool IsSafe(string key) =>
        key.Length > 0 &&
        !key.StartsWith('/') &&
        !key.Contains('\\', StringComparison.Ordinal) &&
        !key.Contains('\0', StringComparison.Ordinal) &&
        !key.Split('/').Any(segment => segment is "" or "." or "..");
}
