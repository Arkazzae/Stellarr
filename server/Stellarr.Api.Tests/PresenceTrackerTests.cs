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

    [Fact]
    public void AMediaSessionNeedsTheSeatOfItsRoom()
    {
        var closer = new RecordingCloser();
        var tracker = new PresenceTracker(closer);
        tracker.Connect("maja-voice", MajaId);

        Assert.False(tracker.AttachMediaSession("maja-voice", SalonId, Media("unseated")));
        tracker.JoinVoice("maja-voice", MajaId, SalonId);
        Assert.False(tracker.AttachMediaSession("maja-voice", NightShiftId, Media("elsewhere")));
        Assert.True(tracker.AttachMediaSession("maja-voice", SalonId, Media("first")));

        Assert.Equal("first", tracker.MediaSessionOf("maja-voice", SalonId)?.SessionId);
        Assert.Null(tracker.MediaSessionOf("maja-voice", NightShiftId));
        Assert.Equal(new SeatedMediaSession("maja-voice", SalonId, Media("first")), tracker.FindMediaSession("first"));
        Assert.Empty(closer.Closed);

        // A newer session of the same seat replaces the older one, which closes.
        Assert.True(tracker.AttachMediaSession("maja-voice", SalonId, Media("second")));
        Assert.Equal(["first"], closer.Closed);
        Assert.Null(tracker.FindMediaSession("first"));
    }

    [Theory]
    [InlineData("leave")]
    [InlineData("disconnect")]
    [InlineData("another room")]
    [InlineData("newer tab")]
    [InlineData("removed from the channel")]
    [InlineData("moved")]
    [InlineData("room ended")]
    [InlineData("session closed")]
    public void EveryChangeOfTheSeatHandsItsMediaSessionToTheCloser(string change)
    {
        var closer = new RecordingCloser();
        var tracker = new PresenceTracker(closer);
        tracker.Connect("maja-voice", MajaId);
        tracker.Connect("maja-other", MajaId);
        tracker.JoinVoice("maja-voice", MajaId, SalonId);
        tracker.AttachMediaSession("maja-voice", SalonId, Media("seated"));

        switch (change)
        {
            case "leave":
                tracker.LeaveVoice("maja-voice");
                break;
            case "disconnect":
                tracker.Disconnect("maja-voice");
                break;
            case "another room":
                tracker.JoinVoice("maja-voice", MajaId, NightShiftId);
                break;
            case "newer tab":
                tracker.JoinVoice("maja-other", MajaId, SalonId);
                break;
            case "removed from the channel":
                tracker.RemoveUserFromVoiceChannels(MajaId, new HashSet<Guid> { SalonId });
                break;
            case "moved":
                tracker.MoveUserBetweenVoiceChannels(MajaId, SalonId, NightShiftId);
                break;
            case "room ended":
                tracker.EndVoiceRoom(SalonId);
                break;
            case "session closed":
                tracker.CloseMediaSession("maja-voice");
                break;
        }

        Assert.Equal(["seated"], closer.Closed);
        Assert.Null(tracker.FindMediaSession("seated"));
        Assert.Null(tracker.MediaSessionOf("maja-voice", NightShiftId));
    }

    [Fact]
    public void ChangesThatKeepTheSeatKeepItsMediaSession()
    {
        var closer = new RecordingCloser();
        var tracker = new PresenceTracker(closer);
        tracker.Connect("maja-voice", MajaId);
        tracker.Connect("ada-voice", AdaId);
        tracker.JoinVoice("maja-voice", MajaId, SalonId);
        tracker.AttachMediaSession("maja-voice", SalonId, Media("seated"));

        tracker.SetVoiceMuted("maja-voice", true);
        tracker.JoinVoice("maja-voice", MajaId, SalonId);
        tracker.JoinVoice("ada-voice", AdaId, SalonId);
        tracker.MoveUserBetweenVoiceChannels(AdaId, SalonId, NightShiftId);
        tracker.RemoveUserFromVoiceChannels(MajaId, new HashSet<Guid> { NightShiftId });

        Assert.Empty(closer.Closed);
        Assert.Equal("seated", tracker.MediaSessionOf("maja-voice", SalonId)?.SessionId);
        Assert.True(Assert.Single(tracker.VoiceUsers(SalonId)).Muted);
    }

    [Fact]
    public void ASessionTheMediaPlaneEndedIsForgottenOnceAndNotClosedAgain()
    {
        var closer = new RecordingCloser();
        var tracker = new PresenceTracker(closer);
        tracker.Connect("maja-voice", MajaId);
        tracker.Connect("ada-voice", AdaId);
        tracker.JoinVoice("maja-voice", MajaId, SalonId);
        tracker.JoinVoice("ada-voice", AdaId, SalonId);
        tracker.AttachMediaSession("maja-voice", SalonId, Media("old-run", "epoch-1"));
        tracker.AttachMediaSession("ada-voice", SalonId, Media("new-run", "epoch-2"));

        var lost = tracker.ForgetMediaSession("old-run");
        var again = tracker.ForgetMediaSession("old-run");
        var restarted = tracker.ForgetMediaSessions(media => media.Epoch != "epoch-2");

        Assert.Equal(new SeatedMediaSession("maja-voice", SalonId, Media("old-run", "epoch-1")), lost);
        Assert.Null(again);
        Assert.Empty(restarted);
        Assert.True(tracker.IsConnectionInVoice("maja-voice", SalonId));
        Assert.Equal("new-run", tracker.MediaSessionOf("ada-voice", SalonId)?.SessionId);

        // The seat that lost its session ends later without a second close.
        tracker.LeaveVoice("maja-voice");
        Assert.Empty(closer.Closed);
    }

    private static MediaSession Media(string sessionId, string epoch = "epoch-1") => new(sessionId, epoch);

    private sealed class RecordingCloser : IMediaSessionCloser
    {
        public List<string> Closed { get; } = [];

        public void Close(MediaSession session) => Closed.Add(session.SessionId);
    }
}
