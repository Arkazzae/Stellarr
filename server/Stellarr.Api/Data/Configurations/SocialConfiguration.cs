using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Stellarr.Api.Domain;

namespace Stellarr.Api.Data.Configurations;

internal sealed class FriendshipConfiguration : IEntityTypeConfiguration<Friendship>
{
    public void Configure(EntityTypeBuilder<Friendship> entity)
    {
        entity.HasKey(x => x.Id);
        entity.HasIndex(x => new { x.UserAId, x.UserBId }).IsUnique();
        entity.HasOne<User>().WithMany().HasForeignKey(x => x.UserAId)
            .OnDelete(DeleteBehavior.Cascade);
        entity.HasOne<User>().WithMany().HasForeignKey(x => x.UserBId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}

internal sealed class FriendRequestConfiguration : IEntityTypeConfiguration<FriendRequest>
{
    public void Configure(EntityTypeBuilder<FriendRequest> entity)
    {
        entity.HasKey(x => x.Id);
        entity.HasIndex(x => x.PairKey).IsUnique();
        entity.Property(x => x.PairKey).HasMaxLength(65);
        entity.HasOne<User>().WithMany().HasForeignKey(x => x.SenderId)
            .OnDelete(DeleteBehavior.Cascade);
        entity.HasOne<User>().WithMany().HasForeignKey(x => x.ReceiverId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}

internal sealed class UserBlockConfiguration : IEntityTypeConfiguration<UserBlock>
{
    public void Configure(EntityTypeBuilder<UserBlock> entity)
    {
        entity.HasKey(x => new { x.BlockerId, x.BlockedId });
        entity.HasOne<User>().WithMany().HasForeignKey(x => x.BlockerId)
            .OnDelete(DeleteBehavior.Cascade);
        entity.HasOne<User>().WithMany().HasForeignKey(x => x.BlockedId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}

internal sealed class DirectConversationConfiguration : IEntityTypeConfiguration<DirectConversation>
{
    public void Configure(EntityTypeBuilder<DirectConversation> entity)
    {
        entity.HasKey(x => x.Id);
        entity.HasIndex(x => new { x.UserAId, x.UserBId }).IsUnique();
        entity.HasOne<User>().WithMany().HasForeignKey(x => x.UserAId)
            .OnDelete(DeleteBehavior.Cascade);
        entity.HasOne<User>().WithMany().HasForeignKey(x => x.UserBId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}

internal sealed class DirectMessageConfiguration : IEntityTypeConfiguration<DirectMessage>
{
    public void Configure(EntityTypeBuilder<DirectMessage> entity)
    {
        entity.HasKey(x => x.Id);
        entity.HasIndex(x => new { x.ConversationId, x.CreatedAt });
        entity.Property(x => x.Content).HasMaxLength(MessageLimits.MaxContentLength);
        entity.HasOne<DirectConversation>().WithMany(x => x.Messages).HasForeignKey(x => x.ConversationId)
            .OnDelete(DeleteBehavior.Cascade);
        entity.HasOne(x => x.Author).WithMany().HasForeignKey(x => x.AuthorId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}

internal sealed class DirectMessageAttachmentConfiguration : IEntityTypeConfiguration<DirectMessageAttachment>
{
    public void Configure(EntityTypeBuilder<DirectMessageAttachment> entity)
    {
        entity.HasKey(x => new { x.DirectMessageId, x.AttachmentId });
        entity.HasOne(x => x.DirectMessage).WithMany(x => x.Attachments).HasForeignKey(x => x.DirectMessageId)
            .OnDelete(DeleteBehavior.Cascade);
        entity.HasOne(x => x.Attachment).WithMany().HasForeignKey(x => x.AttachmentId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}

internal sealed class DirectConversationReadConfiguration : IEntityTypeConfiguration<DirectConversationRead>
{
    public void Configure(EntityTypeBuilder<DirectConversationRead> entity)
    {
        entity.HasKey(x => new { x.ConversationId, x.UserId });
        entity.HasOne<DirectConversation>().WithMany().HasForeignKey(x => x.ConversationId)
            .OnDelete(DeleteBehavior.Cascade);
        entity.HasOne<User>().WithMany().HasForeignKey(x => x.UserId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
