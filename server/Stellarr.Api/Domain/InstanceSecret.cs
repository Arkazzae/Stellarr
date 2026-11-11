namespace Stellarr.Api.Domain;

/// <summary>
/// A secret the operator set in Cockpit, such as the Resend key. The value is
/// encrypted with the instance's data-protection keys in <c>{DataRoot}/keys</c>,
/// so the database alone does not give it away, and without those keys it
/// cannot be read back.
/// </summary>
public sealed class InstanceSecret
{
    public required string Name { get; set; }
    public required string ProtectedValue { get; set; }
    public DateTime UpdatedAt { get; set; }
}
