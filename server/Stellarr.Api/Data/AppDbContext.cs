using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Domain;

namespace Stellarr.Api.Data;

/// <remarks>
/// The DbSet property names are the table names that existing installations
/// already have, so renaming one is a breaking schema change. Entity mappings
/// live in <c>Data/Configurations</c>.
/// </remarks>
public sealed class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();
    public DbSet<UserPreferenceSettings> UserPreferences => Set<UserPreferenceSettings>();
    public DbSet<StellarrServer> Servers => Set<StellarrServer>();
    public DbSet<ServerRole> ServerRoles => Set<ServerRole>();
    public DbSet<ServerMember> ServerMembers => Set<ServerMember>();
    public DbSet<ServerAdminSettings> ServerAdminSettings => Set<ServerAdminSettings>();
    public DbSet<Channel> Channels => Set<Channel>();
    public DbSet<Message> Messages => Set<Message>();
    public DbSet<MessageReaction> MessageReactions => Set<MessageReaction>();
    public DbSet<ImageAttachment> ImageAttachments => Set<ImageAttachment>();
    public DbSet<MessageAttachment> MessageAttachments => Set<MessageAttachment>();
    public DbSet<MessageEmbed> MessageEmbeds => Set<MessageEmbed>();

    protected override void OnModelCreating(ModelBuilder modelBuilder) =>
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(AppDbContext).Assembly);
}
