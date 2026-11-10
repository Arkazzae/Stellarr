using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Stellarr.Api.Domain;

namespace Stellarr.Api.Data.Configurations;

internal sealed class ObjectDeletionConfiguration : IEntityTypeConfiguration<ObjectDeletion>
{
    public void Configure(EntityTypeBuilder<ObjectDeletion> entity)
    {
        entity.HasKey(x => x.ObjectKey);
        entity.Property(x => x.ObjectKey).HasMaxLength(512);
        entity.HasIndex(x => x.QueuedAt);
    }
}
