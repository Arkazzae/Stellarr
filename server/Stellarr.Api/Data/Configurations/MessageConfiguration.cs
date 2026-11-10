using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Stellarr.Api.Domain;

namespace Stellarr.Api.Data.Configurations;

internal sealed class MessageConfiguration : IEntityTypeConfiguration<Message>
{
    public void Configure(EntityTypeBuilder<Message> entity)
    {
        entity.HasKey(x => x.Id);
        entity.HasIndex(x => new { x.ChannelId, x.CreatedAt });
        // The pinned list is "this channel, newest pin first". Nearly every row
        // has a null here, which SQLite indexes, so the scan stays proportional
        // to the pins rather than to the transcript.
        entity.HasIndex(x => new { x.ChannelId, x.PinnedAt });
        entity.Property(x => x.Content).HasMaxLength(MessageLimits.MaxContentLength);
        entity.Property(x => x.IsSystem).HasDefaultValue(false);
        entity.HasOne(x => x.Author).WithMany().HasForeignKey(x => x.AuthorId)
            .OnDelete(DeleteBehavior.Restrict);
        entity.HasOne(x => x.ReplyToMessage).WithMany().HasForeignKey(x => x.ReplyToMessageId)
            .OnDelete(DeleteBehavior.SetNull);
    }
}

internal sealed class MessageReactionConfiguration : IEntityTypeConfiguration<MessageReaction>
{
    public void Configure(EntityTypeBuilder<MessageReaction> entity)
    {
        entity.HasKey(x => new { x.MessageId, x.UserId, x.Emoji });
        entity.HasIndex(x => new { x.MessageId, x.Emoji });
        entity.Property(x => x.Emoji).HasMaxLength(64);
        entity.HasOne(x => x.Message).WithMany(x => x.Reactions).HasForeignKey(x => x.MessageId)
            .OnDelete(DeleteBehavior.Cascade);
        entity.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}

internal sealed class MessageEmbedConfiguration : IEntityTypeConfiguration<MessageEmbed>
{
    public void Configure(EntityTypeBuilder<MessageEmbed> entity)
    {
        entity.HasKey(x => x.Id);
        // Embeds are rebuilt as a set per message, so every read and delete
        // goes through this index.
        entity.HasIndex(x => new { x.MessageId, x.Position });
        entity.Property(x => x.Url).HasMaxLength(2048);
        entity.Property(x => x.Provider).HasMaxLength(64);
        entity.Property(x => x.ProviderId).HasMaxLength(64);
        entity.Property(x => x.Domain).HasMaxLength(255);
        entity.Property(x => x.Title).HasMaxLength(200);
        entity.Property(x => x.Description).HasMaxLength(400);
        entity.HasOne<Message>().WithMany(x => x.Embeds).HasForeignKey(x => x.MessageId)
            .OnDelete(DeleteBehavior.Cascade);
        // Restrict: the thumbnail is an ordinary attachment row, and removing a
        // card must not silently take a stored object with it.
        entity.HasOne(x => x.ThumbnailAttachment).WithMany().HasForeignKey(x => x.ThumbnailAttachmentId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}
