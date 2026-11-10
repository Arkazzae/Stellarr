using Microsoft.Extensions.DependencyInjection;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;

namespace Stellarr.Api.Tests;

/// <summary>Building blocks shared by the tests of the entity model.</summary>
internal static class DataModelSupport
{
    /// <summary>A scope with its own context on the factory's seeded database.</summary>
    internal static AsyncServiceScope OpenScope(this StellarrWebApplicationFactory factory, out AppDbContext db)
    {
        var scope = factory.Services.CreateAsyncScope();
        db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        return scope;
    }

    /// <summary>Adds accounts that no other test knows about and returns them.</summary>
    internal static async Task<User[]> AddUsersAsync(AppDbContext db, int count)
    {
        var users = Enumerable.Range(0, count).Select(_ =>
        {
            var name = UniqueName();
            return new User
            {
                Id = Guid.NewGuid(),
                Username = name,
                NormalizedUsername = name.ToUpperInvariant(),
                DisplayName = name,
                PasswordHash = "hash",
                AvatarColor = "#777777",
                CreatedAt = DateTime.UtcNow,
            };
        }).ToArray();
        db.Users.AddRange(users);
        await db.SaveChangesAsync();
        return users;
    }

    /// <summary>A value that is unique to the test run and short enough for every name column.</summary>
    internal static string UniqueName() => $"n{Guid.NewGuid():N}"[..24];

    /// <summary>A 64-character digest-shaped string.</summary>
    internal static string Hash() => Convert.ToHexString(Guid.NewGuid().ToByteArray()).PadRight(64, '0');

    internal static ImageAttachment Upload(User uploader) => new()
    {
        Id = Guid.NewGuid(),
        UploadedById = uploader.Id,
        ObjectKey = $"uploads/{Guid.NewGuid():N}",
        FileName = "note.txt",
        ContentType = "text/plain",
        SizeBytes = 12,
        CreatedAt = DateTime.UtcNow,
    };
}
