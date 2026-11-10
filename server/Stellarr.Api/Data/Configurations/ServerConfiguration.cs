using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Stellarr.Api.Domain;

namespace Stellarr.Api.Data.Configurations;

internal sealed class ServerConfiguration : IEntityTypeConfiguration<StellarrServer>
{
    public void Configure(EntityTypeBuilder<StellarrServer> entity)
    {
        entity.HasKey(x => x.Id);
        entity.Property(x => x.Name).HasMaxLength(80);
        entity.Property(x => x.Description).HasMaxLength(280).HasDefaultValue("");
        entity.Property(x => x.IsPublic).HasDefaultValue(false);
        entity.Property(x => x.IconUrl).HasMaxLength(256);
    }
}

internal sealed class ServerRoleConfiguration : IEntityTypeConfiguration<ServerRole>
{
    public void Configure(EntityTypeBuilder<ServerRole> entity)
    {
        entity.HasKey(x => x.Id);
        entity.HasIndex(x => new { x.ServerId, x.Name }).IsUnique();
        entity.Property(x => x.Name).HasMaxLength(64);
        entity.Property(x => x.Color).HasMaxLength(48);
        entity.Property(x => x.Permissions).HasConversion<long>();
        entity.HasOne<StellarrServer>().WithMany().HasForeignKey(x => x.ServerId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}

internal sealed class ServerMemberConfiguration : IEntityTypeConfiguration<ServerMember>
{
    public void Configure(EntityTypeBuilder<ServerMember> entity)
    {
        entity.HasKey(x => new { x.ServerId, x.UserId });
        entity.HasIndex(x => new { x.ServerId, x.OwnerSlot }).IsUnique();
        entity.HasOne<StellarrServer>().WithMany().HasForeignKey(x => x.ServerId)
            .OnDelete(DeleteBehavior.Cascade);
        entity.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId)
            .OnDelete(DeleteBehavior.Cascade);
        entity.HasOne(x => x.Role).WithMany().HasForeignKey(x => x.RoleId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}

internal sealed class ServerAdminSettingsConfiguration : IEntityTypeConfiguration<ServerAdminSettings>
{
    public void Configure(EntityTypeBuilder<ServerAdminSettings> entity)
    {
        entity.HasKey(x => x.ServerId);
        entity.Property(x => x.MutedChannelIdsJson).HasMaxLength(4096);
        entity.HasOne<StellarrServer>().WithOne().HasForeignKey<ServerAdminSettings>(x => x.ServerId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
