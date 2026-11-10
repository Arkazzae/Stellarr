using System.Buffers.Binary;
using System.Buffers.Text;

namespace Stellarr.Api.Messaging;

/// <summary>
/// Where a reader is in the history of a channel or a conversation: the
/// moment the first page was requested, and how many messages before it have
/// been delivered. Pinning the moment keeps messages that arrive while the
/// reader pages back from shifting the offsets.
/// </summary>
/// <param name="ScopeId">The channel or conversation the cursor belongs to.</param>
internal readonly record struct HistoryCursor(Guid ScopeId, DateTime Snapshot, int Offset)
{
    private const int ScopeIdSize = 16;
    private const int Size = ScopeIdSize + sizeof(long) + sizeof(int);

    /// <summary>The opaque text clients hand back to get the next page.</summary>
    public string Encode()
    {
        Span<byte> bytes = stackalloc byte[Size];
        ScopeId.TryWriteBytes(bytes);
        BinaryPrimitives.WriteInt64BigEndian(bytes[ScopeIdSize..], Snapshot.Ticks);
        BinaryPrimitives.WriteInt32BigEndian(bytes[(ScopeIdSize + sizeof(long))..], Offset);
        return Base64Url.EncodeToString(bytes);
    }

    public static bool TryDecode(string encoded, out HistoryCursor cursor)
    {
        cursor = default;
        if (!Base64Url.IsValid(encoded, out var decodedLength) || decodedLength != Size)
        {
            return false;
        }

        Span<byte> bytes = stackalloc byte[Size];
        Base64Url.DecodeFromChars(encoded, bytes);

        var ticks = BinaryPrimitives.ReadInt64BigEndian(bytes[ScopeIdSize..]);
        var offset = BinaryPrimitives.ReadInt32BigEndian(bytes[(ScopeIdSize + sizeof(long))..]);
        if (ticks < 0 || ticks > DateTime.MaxValue.Ticks || offset < 0)
        {
            return false;
        }

        cursor = new HistoryCursor(
            new Guid(bytes[..ScopeIdSize]),
            new DateTime(ticks, DateTimeKind.Utc),
            offset);
        return true;
    }
}
