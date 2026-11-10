using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Stellarr.Api.Domain;

namespace Stellarr.Api.Data.Configurations;

internal sealed class UserNotificationConfiguration : IEntityTypeConfiguration<UserNotification>
{
    public void Configure(EntityTypeBuilder<UserNotification> entity)
    {
        entity.HasKey(x => x.Sequence);
        entity.Property(x => x.Sequence).ValueGeneratedOnAdd();
        entity.HasIndex(x => x.Id).IsUnique();
        entity.HasIndex(x => new { x.ServerId, x.UserId, x.Sequence });
        entity.HasIndex(x => new { x.ServerId, x.UserId, x.ReadAt, x.Sequence });
        entity.HasIndex(x => new { x.UserId, x.ReadAt, x.Sequence });
        entity.Property(x => x.Source).HasMaxLength(16);
        entity.Property(x => x.SourcePackageId).HasMaxLength(128);
        entity.Property(x => x.SourcePackageName).HasMaxLength(100);
        entity.Property(x => x.SourceModuleId).HasMaxLength(64);
        entity.Property(x => x.SourceModuleName).HasMaxLength(100);
        entity.Property(x => x.Title).HasMaxLength(100);
        entity.Property(x => x.Body).HasMaxLength(1_000);
        entity.Property(x => x.Tone).HasMaxLength(16);
        entity.Property(x => x.TargetInviteCode).HasMaxLength(64);
        entity.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId)
            .OnDelete(DeleteBehavior.Cascade);
        entity.HasOne(x => x.Server).WithMany().HasForeignKey(x => x.ServerId)
            .OnDelete(DeleteBehavior.Cascade);
        entity.HasOne(x => x.TargetChannel).WithMany().HasForeignKey(x => x.TargetChannelId)
            .OnDelete(DeleteBehavior.SetNull);
    }
}
