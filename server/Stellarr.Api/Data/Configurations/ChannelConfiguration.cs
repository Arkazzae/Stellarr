using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Stellarr.Api.Domain;

namespace Stellarr.Api.Data.Configurations;

internal sealed class ChannelConfiguration : IEntityTypeConfiguration<Channel>
{
    public void Configure(EntityTypeBuilder<Channel> entity)
    {
        entity.HasKey(x => x.Id);
        entity.HasIndex(x => new { x.ServerId, x.Name }).IsUnique();
        entity.HasIndex(x => x.SectionId);
        entity.Property(x => x.Name).HasMaxLength(80);
        entity.Property(x => x.Topic).HasMaxLength(1024).HasDefaultValue("");
        entity.Property(x => x.AudioProfile).HasMaxLength(16).HasDefaultValue("premium");
    }
}
