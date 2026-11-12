using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Stellarr.Api.Domain;

namespace Stellarr.Api.Data.Configurations;

internal sealed class OperatorAuditEntryConfiguration : IEntityTypeConfiguration<OperatorAuditEntry>
{
    public void Configure(EntityTypeBuilder<OperatorAuditEntry> entity)
    {
        entity.HasKey(x => x.Id);
        entity.HasIndex(x => x.CreatedAt);
        entity.Property(x => x.Actor).HasMaxLength(64);
        entity.Property(x => x.Operation).HasMaxLength(64);
        entity.Property(x => x.Target).HasMaxLength(256);
    }
}
