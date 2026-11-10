using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Stellarr.Api.Domain;

namespace Stellarr.Api.Data.Configurations;

internal sealed class ServerEmojiConfiguration : IEntityTypeConfiguration<ServerEmoji>
{
    public void Configure(EntityTypeBuilder<ServerEmoji> entity)
    {
        entity.HasKey(x => x.Id);
        entity.HasIndex(x => new { x.ServerId, x.Shortcode }).IsUnique();
        entity.HasIndex(x => x.ObjectKey).IsUnique();
        entity.Property(x => x.Shortcode).HasMaxLength(32);
        entity.Property(x => x.ObjectKey).HasMaxLength(512);
        entity.Property(x => x.ContentType).HasMaxLength(80);
        entity.HasOne<StellarrServer>().WithMany().HasForeignKey(x => x.ServerId)
            .OnDelete(DeleteBehavior.Cascade);
        entity.HasOne<User>().WithMany().HasForeignKey(x => x.UploadedById)
            .OnDelete(DeleteBehavior.Restrict);
    }
}
