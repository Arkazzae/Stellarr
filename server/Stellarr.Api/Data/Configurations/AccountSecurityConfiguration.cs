using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Stellarr.Api.Domain;

namespace Stellarr.Api.Data.Configurations;

internal sealed class MfaMethodConfiguration : IEntityTypeConfiguration<MfaMethod>
{
    public void Configure(EntityTypeBuilder<MfaMethod> entity)
    {
        entity.HasKey(x => x.Id);
        entity.HasIndex(x => new { x.UserId, x.RevokedAt });
        entity.Property(x => x.Type).HasMaxLength(16);
        entity.Property(x => x.Name).HasMaxLength(64);
        entity.Property(x => x.ProtectedSecret).HasMaxLength(4096);
        entity.Property(x => x.EmailAddress).HasMaxLength(320);
        entity.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}

internal sealed class RecoveryCodeConfiguration : IEntityTypeConfiguration<RecoveryCode>
{
    public void Configure(EntityTypeBuilder<RecoveryCode> entity)
    {
        entity.HasKey(x => x.Id);
        entity.HasIndex(x => x.CodeHash).IsUnique();
        entity.HasIndex(x => new { x.UserId, x.BatchId });
        entity.Property(x => x.CodeHash).HasMaxLength(64);
        entity.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}

internal sealed class TrustedDeviceConfiguration : IEntityTypeConfiguration<TrustedDevice>
{
    public void Configure(EntityTypeBuilder<TrustedDevice> entity)
    {
        entity.HasKey(x => x.Id);
        entity.HasIndex(x => x.TokenHash).IsUnique();
        entity.HasIndex(x => new { x.UserId, x.ExpiresAt });
        entity.Property(x => x.TokenHash).HasMaxLength(64);
        entity.Property(x => x.Name).HasMaxLength(64);
        entity.Property(x => x.Device).HasMaxLength(300);
        entity.Property(x => x.IpAddress).HasMaxLength(64);
        entity.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}

internal sealed class AuthChallengeConfiguration : IEntityTypeConfiguration<AuthChallenge>
{
    public void Configure(EntityTypeBuilder<AuthChallenge> entity)
    {
        entity.HasKey(x => x.Id);
        entity.HasIndex(x => new { x.UserId, x.Purpose, x.ExpiresAt });
        entity.Property(x => x.Purpose).HasMaxLength(16);
        entity.Property(x => x.SecretHash).HasMaxLength(64);
        entity.Property(x => x.PrimarySource).HasMaxLength(32);
        entity.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}

internal sealed class EmailOtpCodeConfiguration : IEntityTypeConfiguration<EmailOtpCode>
{
    public void Configure(EntityTypeBuilder<EmailOtpCode> entity)
    {
        entity.HasKey(x => x.Id);
        entity.HasIndex(x => new { x.UserId, x.Purpose, x.CreatedAt });
        entity.HasIndex(x => new { x.ChallengeId, x.Purpose });
        entity.Property(x => x.Purpose).HasMaxLength(16);
        entity.Property(x => x.EmailAddress).HasMaxLength(320);
        entity.Property(x => x.ProtectedCode).HasMaxLength(2048);
        entity.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}

internal sealed class CliRecoveryCredentialConfiguration : IEntityTypeConfiguration<CliRecoveryCredential>
{
    public void Configure(EntityTypeBuilder<CliRecoveryCredential> entity)
    {
        entity.HasKey(x => x.Id);
        entity.HasIndex(x => x.TokenHash).IsUnique();
        entity.HasIndex(x => new { x.UserId, x.ExpiresAt });
        entity.Property(x => x.TokenHash).HasMaxLength(64);
        entity.Property(x => x.Reason).HasMaxLength(500);
        entity.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}

internal sealed class SecurityEventConfiguration : IEntityTypeConfiguration<SecurityEvent>
{
    public void Configure(EntityTypeBuilder<SecurityEvent> entity)
    {
        entity.HasKey(x => x.Id);
        entity.HasIndex(x => new { x.UserId, x.CreatedAt });
        entity.Property(x => x.Kind).HasMaxLength(64);
        entity.Property(x => x.Detail).HasMaxLength(500);
        entity.Property(x => x.IpAddress).HasMaxLength(64);
        entity.Property(x => x.Device).HasMaxLength(300);
        entity.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}

internal sealed class SecurityNotificationConfiguration : IEntityTypeConfiguration<SecurityNotification>
{
    public void Configure(EntityTypeBuilder<SecurityNotification> entity)
    {
        entity.HasKey(x => x.Id);
        entity.HasIndex(x => new { x.SentAt, x.NextAttemptAt });
        entity.Property(x => x.EmailAddress).HasMaxLength(320);
        entity.Property(x => x.LastError).HasMaxLength(500);
        entity.HasOne(x => x.SecurityEvent).WithMany().HasForeignKey(x => x.SecurityEventId)
            .OnDelete(DeleteBehavior.Cascade);
        entity.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId)
            .OnDelete(DeleteBehavior.NoAction);
    }
}
