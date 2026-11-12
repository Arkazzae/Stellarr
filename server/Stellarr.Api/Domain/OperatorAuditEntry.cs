namespace Stellarr.Api.Domain;

/// <summary>
/// A change an operator made from the local console, outside the API. The
/// application audit log needs a real user as the actor, which would
/// misrepresent a command run through <c>docker exec</c>; this entry names the
/// console instead and leaves user accounts out of it.
/// </summary>
public sealed class OperatorAuditEntry
{
    public Guid Id { get; set; }

    /// <summary>Always <c>local-cli</c> for this release.</summary>
    public required string Actor { get; set; }

    /// <summary>A stable operation name such as <c>config.set</c>.</summary>
    public required string Operation { get; set; }

    /// <summary>What was changed: a setting, secret name, session id or account id.</summary>
    public required string Target { get; set; }

    public DateTime CreatedAt { get; set; }
}
