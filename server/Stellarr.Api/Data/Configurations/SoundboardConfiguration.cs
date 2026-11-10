using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Stellarr.Api.Domain;

namespace Stellarr.Api.Data.Configurations;

internal sealed class SoundboardSoundConfiguration : IEntityTypeConfiguration<SoundboardSound>
{
    public void Configure(EntityTypeBuilder<SoundboardSound> entity)
    {
        entity.HasKey(x => x.Id);
        entity.HasIndex(x => new { x.ServerId, x.Position });
        entity.HasIndex(x => x.AttachmentId).IsUnique();
        entity.Property(x => x.Name).HasMaxLength(32);
        entity.Property(x => x.Glyph).HasMaxLength(16);
        entity.HasOne(x => x.Server).WithMany().HasForeignKey(x => x.ServerId)
            .OnDelete(DeleteBehavior.Cascade);
        entity.HasOne(x => x.Attachment).WithMany().HasForeignKey(x => x.AttachmentId)
            .OnDelete(DeleteBehavior.Restrict);
        entity.HasOne<User>().WithMany().HasForeignKey(x => x.CreatedById)
            .OnDelete(DeleteBehavior.Restrict);
    }
}
