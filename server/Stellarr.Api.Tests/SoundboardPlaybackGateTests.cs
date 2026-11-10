using Stellarr.Api.Realtime;

namespace Stellarr.Api.Tests;

public sealed class SoundboardPlaybackGateTests
{
    [Fact]
    public void CooldownIsAtomicForOneUserAndServer()
    {
        var gate = new SoundboardPlaybackGate();
        var userId = Guid.NewGuid();
        var serverId = Guid.NewGuid();

        var accepted = ParallelEnumerable.Range(0, 32)
            .Select(_ => gate.TryAcquire(userId, serverId, TimeSpan.FromMinutes(1)))
            .Count(result => result);

        Assert.Equal(1, accepted);
    }

    [Fact]
    public void CooldownDoesNotLeakAcrossServers()
    {
        var gate = new SoundboardPlaybackGate();
        var userId = Guid.NewGuid();

        Assert.True(gate.TryAcquire(userId, Guid.NewGuid(), TimeSpan.FromMinutes(1)));
        Assert.True(gate.TryAcquire(userId, Guid.NewGuid(), TimeSpan.FromMinutes(1)));
    }
}
