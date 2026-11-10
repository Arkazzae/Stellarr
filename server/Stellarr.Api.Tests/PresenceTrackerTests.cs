using Stellarr.Api.Realtime;

namespace Stellarr.Api.Tests;

public sealed class PresenceTrackerTests
{
    private static readonly Guid MajaId = Guid.Parse("30000000-0000-0000-0000-000000000001");
    private static readonly Guid AdaId = Guid.Parse("30000000-0000-0000-0000-000000000002");
    private static readonly Guid SalonId = Guid.Parse("20000000-0000-0000-0000-000000000002");
    private static readonly Guid NightShiftId = Guid.Parse("20000000-0000-0000-0000-000000000005");

    [Fact]
    public void ChosenPresenceIsSharedByAllConnectionsAndOfflineWinsAfterTheLastOneLeaves()
    {
        var tracker = new PresenceTracker();

        Assert.True(tracker.Connect("maja-one", MajaId));
        Assert.False(tracker.Connect("maja-two", MajaId));
        Assert.Equal("online", tracker.PresenceOf(MajaId));

        Assert.True(tracker.SetPresence(MajaId, "dnd"));
        Assert.False(tracker.SetPresence(MajaId, "dnd"));
        Assert.Equal("dnd", tracker.PresenceOf(MajaId));

        Assert.False(tracker.Disconnect("maja-one").BecameOffline);
        Assert.Equal("dnd", tracker.PresenceOf(MajaId));

        Assert.True(tracker.Disconnect("maja-two").BecameOffline);
        Assert.Equal("offline", tracker.PresenceOf(MajaId));

        Assert.True(tracker.Connect("maja-reconnected", MajaId));
        Assert.Equal("dnd", tracker.PresenceOf(MajaId));
    }

    [Fact]
    public void HiddenPresenceIsOfflineToObserversButRemainsVisibleToItsOwner()
    {
        var tracker = new PresenceTracker();
        tracker.Connect("maja-hidden", MajaId, showPresence: false);
        tracker.SetPresence(MajaId, "dnd");

        Assert.Equal("dnd", tracker.PresenceOf(MajaId));
        Assert.Equal("dnd", tracker.PublicPresenceOf(MajaId, MajaId));
        Assert.Equal("offline", tracker.PublicPresenceOf(MajaId, AdaId));
        Assert.True(tracker.SetVisibility(MajaId, showPresence: true));
        Assert.Equal("dnd", tracker.PublicPresenceOf(MajaId, AdaId));
    }

    [Fact]
    public void VoiceSeatBelongsToTheConnectionThatJoinedIt()
    {
        var tracker = new PresenceTracker();
        tracker.Connect("maja-voice", MajaId);
        tracker.Connect("maja-chat", MajaId);
        tracker.Connect("ada-voice", AdaId);

        tracker.JoinVoice("maja-voice", MajaId, SalonId);
        tracker.JoinVoice("ada-voice", AdaId, SalonId);
        tracker.SetVoiceMuted("maja-voice", true);

        Assert.Equal(2, tracker.VoiceUsers(SalonId).Count);
        Assert.Single(tracker.VoiceConnectionIds(MajaId, SalonId));
        Assert.False(tracker.IsConnectionInVoice("maja-chat", SalonId));

        var disconnect = tracker.Disconnect("maja-voice");

        Assert.False(disconnect.BecameOffline);
        Assert.Equal(SalonId, disconnect.VoiceDeparture?.ChannelId);
        Assert.DoesNotContain(tracker.VoiceUsers(SalonId), participant => participant.UserId == MajaId);
        Assert.Equal("online", tracker.PresenceOf(MajaId));
    }

    [Fact]
    public void VoiceSnapshotsCarryAProcessMonotonicSequence()
    {
        var tracker = new PresenceTracker();
        tracker.Connect("maja-voice", MajaId);
        tracker.Connect("ada-voice", AdaId);
        tracker.JoinVoice("maja-voice", MajaId, SalonId);

        var first = tracker.VoiceSnapshot(SalonId);
        tracker.JoinVoice("ada-voice", AdaId, SalonId);
        var second = tracker.VoiceSnapshot(SalonId);
        var otherRoom = tracker.VoiceSnapshot(NightShiftId);

        Assert.True(first.Sequence < second.Sequence);
        Assert.True(second.Sequence < otherRoom.Sequence);
        Assert.Single(first.Participants);
        Assert.Equal(2, second.Participants.Count);
        Assert.Empty(otherRoom.Participants);
    }

    [Fact]
    public void NewVoiceConnectionDisplacesTheOlderConnectionForTheSameUser()
    {
        var tracker = new PresenceTracker();
        tracker.Connect("maja-one", MajaId);
        tracker.Connect("maja-two", MajaId);
        tracker.JoinVoice("maja-one", MajaId, SalonId);
        tracker.SetVoiceMuted("maja-one", true);
        var join = tracker.JoinVoice("maja-two", MajaId, SalonId);

        var participant = Assert.Single(tracker.VoiceUsers(SalonId));
        Assert.False(participant.Muted);
        var displaced = Assert.Single(join.Displaced);
        Assert.Equal("maja-one", displaced.ConnectionId);
        Assert.False(tracker.IsConnectionInVoice("maja-one", SalonId));
        Assert.True(tracker.IsConnectionInVoice("maja-two", SalonId));
    }

    [Fact]
    public void VoiceUserLimitIsCheckedAtomicallyWithSeatAssignment()
    {
        var tracker = new PresenceTracker();
        tracker.Connect("maja-voice", MajaId);
        tracker.Connect("ada-voice", AdaId);

        Assert.True(tracker.JoinVoice("maja-voice", MajaId, SalonId, userLimit: 1).Accepted);
        Assert.False(tracker.JoinVoice("ada-voice", AdaId, SalonId, userLimit: 1).Accepted);
        Assert.Equal(MajaId, Assert.Single(tracker.VoiceUsers(SalonId)).UserId);
    }

    [Fact]
    public void ModeratorMoveKeepsTheConnectionAndMuteStateButChangesItsChannel()
    {
        var tracker = new PresenceTracker();
        tracker.Connect("ada-voice", AdaId);
        tracker.JoinVoice("ada-voice", AdaId, SalonId);
        tracker.SetVoiceMuted("ada-voice", true);

        var result = tracker.MoveUserBetweenVoiceChannels(AdaId, SalonId, NightShiftId);

        Assert.True(result.Moved);
        Assert.Equal("ada-voice", Assert.Single(result.ConnectionIds));
        Assert.Empty(tracker.VoiceUsers(SalonId));
        var participant = Assert.Single(tracker.VoiceUsers(NightShiftId));
        Assert.Equal(AdaId, participant.UserId);
        Assert.True(participant.Muted);
    }
}
