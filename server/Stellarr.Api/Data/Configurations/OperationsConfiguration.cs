using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Stellarr.Api.Domain;

namespace Stellarr.Api.Data.Configurations;

internal sealed class OperationsSettingsConfiguration : IEntityTypeConfiguration<OperationsSettings>
{
    public void Configure(EntityTypeBuilder<OperationsSettings> entity)
    {
        entity.HasKey(x => x.ServerId);
        entity.Property(x => x.PublicUrl).HasMaxLength(2048);
        entity.Property(x => x.TimeZone).HasMaxLength(128);
        entity.Property(x => x.MailFromAddress).HasMaxLength(320);
        entity.Property(x => x.MailSmtpHost).HasMaxLength(255).HasDefaultValue("");
        entity.Property(x => x.MailSmtpPort).HasDefaultValue(OperationsSettings.DefaultSmtpPort);
        entity.Property(x => x.MailSmtpUsername).HasMaxLength(320).HasDefaultValue("");
        entity.Property(x => x.MailSmtpSecurity).HasMaxLength(16).HasDefaultValue("starttls");
        entity.Property(x => x.DesktopMinimumVersion).HasMaxLength(64);
        entity.Property(x => x.DesktopRecommendedVersion).HasMaxLength(64);
        entity.HasOne(x => x.Server).WithOne().HasForeignKey<OperationsSettings>(x => x.ServerId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}

internal sealed class InstanceSecretConfiguration : IEntityTypeConfiguration<InstanceSecret>
{
    public void Configure(EntityTypeBuilder<InstanceSecret> entity)
    {
        entity.HasKey(x => x.Name);
        entity.Property(x => x.Name).HasMaxLength(64);
    }
}
