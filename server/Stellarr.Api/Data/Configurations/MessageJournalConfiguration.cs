using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Stellarr.Api.Domain;

namespace Stellarr.Api.Data.Configurations;

internal sealed class MessageChangeConfiguration : IEntityTypeConfiguration<MessageChange>
{
    public void Configure(EntityTypeBuilder<MessageChange> entity)
    {
        entity.HasKey(x => x.Sequence);
        entity.Property(x => x.Sequence).ValueGeneratedOnAdd();
        entity.HasIndex(x => new { x.ChannelId, x.Sequence });
    }
}

internal sealed class MessageIndexEntryConfiguration : IEntityTypeConfiguration<MessageIndexEntry>
{
    public void Configure(EntityTypeBuilder<MessageIndexEntry> entity)
    {
        entity.HasKey(x => x.MessageId);
        entity.Property(x => x.SearchText).HasDefaultValue("");
        // The media and link views list a channel's newest matches first.
        entity.HasIndex(x => new { x.ChannelId, x.HasAttachments, x.CreatedAt, x.MessageId })
            .IsDescending(false, false, true, true);
        entity.HasIndex(x => new { x.ChannelId, x.HasLinks, x.CreatedAt, x.MessageId })
            .IsDescending(false, false, true, true);
        entity.HasOne<Message>().WithOne().HasForeignKey<MessageIndexEntry>(x => x.MessageId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
