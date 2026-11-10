using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Stellarr.Api.Domain;

namespace Stellarr.Api.Data.Configurations;

internal sealed class ImageAttachmentConfiguration : IEntityTypeConfiguration<ImageAttachment>
{
    public void Configure(EntityTypeBuilder<ImageAttachment> entity)
    {
        entity.HasKey(x => x.Id);
        entity.HasIndex(x => x.ObjectKey).IsUnique();
        entity.Property(x => x.ObjectKey).HasMaxLength(512);
        entity.Property(x => x.FileName).HasMaxLength(255);
        entity.Property(x => x.ContentType).HasMaxLength(80);
        entity.Property(x => x.IsVoiceMessage).HasDefaultValue(false);
        entity.Property(x => x.PosterObjectKey).HasMaxLength(512);
        entity.Property(x => x.PosterContentType).HasMaxLength(80);
    }
}

internal sealed class MessageAttachmentConfiguration : IEntityTypeConfiguration<MessageAttachment>
{
    public void Configure(EntityTypeBuilder<MessageAttachment> entity)
    {
        entity.HasKey(x => new { x.MessageId, x.AttachmentId });
        entity.HasOne<Message>().WithMany(x => x.Attachments).HasForeignKey(x => x.MessageId)
            .OnDelete(DeleteBehavior.Cascade);
        entity.HasOne(x => x.Attachment).WithMany().HasForeignKey(x => x.AttachmentId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}
