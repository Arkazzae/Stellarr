using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Stellarr.Api.Domain;

namespace Stellarr.Api.Data.Configurations;

internal sealed class ChannelReadConfiguration : IEntityTypeConfiguration<ChannelRead>
{
    public void Configure(EntityTypeBuilder<ChannelRead> entity)
    {
        entity.HasKey(x => new { x.ChannelId, x.UserId });
        entity.HasOne<Channel>().WithMany().HasForeignKey(x => x.ChannelId)
            .OnDelete(DeleteBehavior.Cascade);
        entity.HasOne<User>().WithMany().HasForeignKey(x => x.UserId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
