using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Stellarr.Api.Domain;

namespace Stellarr.Api.Data.Configurations;

internal sealed class ServerBanConfiguration : IEntityTypeConfiguration<ServerBan>
{
    public void Configure(EntityTypeBuilder<ServerBan> entity)
    {
        entity.HasKey(x => new { x.ServerId, x.UserId });
        entity.HasIndex(x => new { x.ServerId, x.BannedAt });
        entity.Property(x => x.Reason).HasMaxLength(500);
        entity.HasOne<StellarrServer>().WithMany().HasForeignKey(x => x.ServerId)
            .OnDelete(DeleteBehavior.Cascade);
        entity.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId)
            .OnDelete(DeleteBehavior.Cascade);
        entity.HasOne(x => x.BannedBy).WithMany().HasForeignKey(x => x.BannedById)
            .OnDelete(DeleteBehavior.Restrict);
    }
}

internal sealed class ServerInviteConfiguration : IEntityTypeConfiguration<ServerInvite>
{
    public void Configure(EntityTypeBuilder<ServerInvite> entity)
    {
        entity.HasKey(x => x.Id);
        entity.HasIndex(x => x.Code).IsUnique();
        entity.Property(x => x.Code).HasMaxLength(32);
        entity.HasOne<StellarrServer>().WithMany().HasForeignKey(x => x.ServerId)
            .OnDelete(DeleteBehavior.Cascade);
        entity.HasOne(x => x.CreatedBy).WithMany().HasForeignKey(x => x.CreatedById)
            .OnDelete(DeleteBehavior.Restrict);
        entity.HasOne(x => x.Channel).WithMany().HasForeignKey(x => x.ChannelId)
            .OnDelete(DeleteBehavior.SetNull);
    }
}

internal sealed class ServerAuditEntryConfiguration : IEntityTypeConfiguration<ServerAuditEntry>
{
    public void Configure(EntityTypeBuilder<ServerAuditEntry> entity)
    {
        entity.HasKey(x => x.Id);
        entity.HasIndex(x => new { x.ServerId, x.CreatedAt });
        entity.Property(x => x.Summary).HasMaxLength(500);
        entity.HasOne<StellarrServer>().WithMany().HasForeignKey(x => x.ServerId)
            .OnDelete(DeleteBehavior.Cascade);
        entity.HasOne(x => x.Actor).WithMany().HasForeignKey(x => x.ActorId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}
