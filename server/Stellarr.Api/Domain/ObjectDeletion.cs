namespace Stellarr.Api.Domain;

/// <summary>
/// A durable queue of stored objects whose owning row is already gone. Keeping
/// the intent in the database lets the cleanup survive an object store outage
/// or a restart, so no object stays orphaned for good.
/// </summary>
public sealed class ObjectDeletion
{
    public required string ObjectKey { get; set; }
    public DateTime QueuedAt { get; set; }
}
