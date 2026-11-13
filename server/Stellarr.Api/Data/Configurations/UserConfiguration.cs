using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Stellarr.Api.Domain;

namespace Stellarr.Api.Data.Configurations;

internal sealed class UserConfiguration : IEntityTypeConfiguration<User>
{
    public void Configure(EntityTypeBuilder<User> entity)
    {
        entity.HasKey(x => x.Id);
        entity.HasIndex(x => x.NormalizedUsername).IsUnique();
        entity.HasIndex(x => x.NormalizedEmail).IsUnique();
        entity.Property(x => x.Username).HasMaxLength(32);
        entity.Property(x => x.NormalizedUsername).HasMaxLength(32);
        entity.Property(x => x.DisplayName).HasMaxLength(64);
        entity.Property(x => x.PasswordHash).HasMaxLength(512);
        entity.Property(x => x.Email).HasMaxLength(320);
        entity.Property(x => x.NormalizedEmail).HasMaxLength(320);
        entity.Property(x => x.AvatarColor).HasMaxLength(48);
        entity.Property(x => x.AvatarUrl).HasMaxLength(256);
        entity.Property(x => x.BannerUrl).HasMaxLength(256);
        // The UI caps the status at 128 characters and the bio at 2000. The
        // columns leave room, so a longer value written before those caps
        // fails validation instead of being truncated.
        entity.Property(x => x.CustomStatus).HasMaxLength(256);
        entity.Property(x => x.Bio).HasMaxLength(4000);
        entity.Property(x => x.Pronouns).HasMaxLength(32);
        entity.HasOne(x => x.Preferences)
            .WithOne(x => x.User)
            .HasForeignKey<UserPreferenceSettings>(x => x.UserId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}

internal sealed class UserPreferenceSettingsConfiguration : IEntityTypeConfiguration<UserPreferenceSettings>
{
    public void Configure(EntityTypeBuilder<UserPreferenceSettings> entity)
    {
        entity.HasKey(x => x.UserId);
        entity.Property(x => x.MutedChannelIdsJson).HasMaxLength(4096).HasDefaultValue("[]");
        entity.Property(x => x.AppearanceSettingsJson).HasMaxLength(ClientSettings.MaxLength);
        entity.Property(x => x.LanguageSettingsJson).HasMaxLength(ClientSettings.MaxLength);
        entity.Property(x => x.KeybindSettingsJson).HasMaxLength(ClientSettings.MaxLength);
        entity.Property(x => x.VoiceSettingsJson).HasMaxLength(ClientSettings.MaxLength);
    }
}
