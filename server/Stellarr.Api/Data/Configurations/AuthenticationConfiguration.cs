using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Stellarr.Api.Domain;

namespace Stellarr.Api.Data.Configurations;

internal sealed class PasswordResetTokenConfiguration : IEntityTypeConfiguration<PasswordResetToken>
{
    public void Configure(EntityTypeBuilder<PasswordResetToken> entity)
    {
        entity.HasKey(x => x.Id);
        entity.HasIndex(x => x.TokenHash).IsUnique();
        entity.HasIndex(x => new { x.UserId, x.ExpiresAt });
        entity.Property(x => x.TokenHash).HasMaxLength(64);
        entity.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}

internal sealed class ExternalIdentityConfiguration : IEntityTypeConfiguration<ExternalIdentity>
{
    public void Configure(EntityTypeBuilder<ExternalIdentity> entity)
    {
        entity.HasKey(x => x.Id);
        entity.HasIndex(x => new { x.Issuer, x.Subject }).IsUnique();
        entity.HasIndex(x => new { x.UserId, x.Issuer }).IsUnique();
        entity.Property(x => x.Issuer).HasMaxLength(512);
        entity.Property(x => x.Subject).HasMaxLength(255);
        entity.Property(x => x.ProviderId).HasMaxLength(32);
        entity.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}

internal sealed class UserSessionConfiguration : IEntityTypeConfiguration<UserSession>
{
    public void Configure(EntityTypeBuilder<UserSession> entity)
    {
        entity.HasKey(x => x.Id);
        entity.HasIndex(x => new { x.UserId, x.LastSeenAt });
        entity.Property(x => x.Device).HasMaxLength(300);
        entity.Property(x => x.IpAddress).HasMaxLength(64);
        entity.Property(x => x.PrimarySource).HasMaxLength(32).HasDefaultValue("password");
        entity.Property(x => x.MfaEvidence).HasMaxLength(32);
        entity.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}

internal sealed class DesktopBrowserLoginConfiguration : IEntityTypeConfiguration<DesktopBrowserLogin>
{
    public void Configure(EntityTypeBuilder<DesktopBrowserLogin> entity)
    {
        entity.HasKey(x => x.Id);
        entity.HasIndex(x => x.ExpiresAt);
        entity.Property(x => x.SecretHash).HasMaxLength(64);
        entity.Property(x => x.ApprovalTokenHash).HasMaxLength(64);
        entity.Property(x => x.PrimarySource).HasMaxLength(32);
        entity.Property(x => x.MfaEvidence).HasMaxLength(32);
        entity.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
