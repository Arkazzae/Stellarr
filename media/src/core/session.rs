//! What the core keeps for one session: its connection, what it publishes,
//! what it receives and where its negotiation stands.

use std::collections::{HashMap, HashSet, VecDeque};
use std::net::SocketAddr;
use std::time::Instant;

use str0m::change::SdpPendingOffer;
use str0m::media::{KeyframeRequestKind, MediaKind, Mid};
use str0m::rtp::Ssrc;
use str0m::{IceConnectionState, Rtc};

use super::{
    CONNECT_TIMEOUT, DISCONNECT_TIMEOUT, KEYFRAME_INTERVAL, MAX_SOURCE_ADDRS, OFFER_TIMEOUT,
};
use crate::sdp_text::{self, FormatOrders, OpusParams};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub(crate) struct SessionKey(pub u64);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) struct RoomKey(pub u64);

/// A track is named by the session that publishes it and the mid of the
/// publisher's section that carries it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) struct TrackKey {
    pub session: SessionKey,
    pub mid: Mid,
}

/// The transport milestones the 30 second rules are measured against.
#[derive(Debug)]
pub(crate) struct Transport {
    /// ICE, DTLS and SRTP have been up at least once.
    pub ever_connected: bool,
    pub ice: IceConnectionState,
    /// Since when a connection that was up has been down.
    pub disconnected_since: Option<Instant>,
}

pub(crate) struct PendingOffer {
    pub id: u64,
    pub pending: SdpPendingOffer,
    pub sent_at: Instant,
    /// Sections this offer makes inactive. The browser has heard of their
    /// withdrawal once it answers.
    pub inactive: Vec<Mid>,
}

#[derive(Default)]
pub(crate) struct Negotiation {
    /// The browser's first offer has been answered. The media server never
    /// offers before that, so the browser always offers first.
    pub remote_described: bool,
    pub pending: Option<PendingOffer>,
    /// The `negotiationId` of the last offer the media server made.
    pub last_id: u64,
    /// Offers in a row that timed out without an answer.
    pub unanswered: u32,
}

/// Keyframe requests to a publisher are rate limited per track. A request
/// that comes too soon is held and sent when the window ends, so a second
/// receiver that starts shortly after the first still gets its keyframe.
#[derive(Debug, Default)]
pub(crate) struct KeyframeGate {
    pub last: Option<Instant>,
    pub pending: Option<KeyframeRequestKind>,
}

impl KeyframeGate {
    pub fn hold(&mut self, kind: KeyframeRequestKind) {
        // FIR asks for more than PLI, so it is the one that is kept.
        self.pending = match (self.pending, kind) {
            (Some(KeyframeRequestKind::Fir), _) | (_, KeyframeRequestKind::Fir) => {
                Some(KeyframeRequestKind::Fir)
            }
            _ => Some(KeyframeRequestKind::Pli),
        };
    }

    pub fn can_send(&self, now: Instant) -> bool {
        self.last.is_none_or(|last| now >= last + KEYFRAME_INTERVAL)
    }

    /// When a held request may go out. A request is only ever held after
    /// one was sent, so there always is a last one to count from.
    pub fn due(&self) -> Option<Instant> {
        self.pending?;
        Some(self.last? + KEYFRAME_INTERVAL)
    }
}

/// A section of the browser's description that sends towards the media
/// server.
#[derive(Debug)]
pub(crate) struct Published {
    pub mid: Mid,
    pub kind: MediaKind,
    /// The stream id the publisher currently gives the track; empty when it
    /// names none.
    pub stream_id: String,
    pub keyframe: KeyframeGate,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum OutState {
    /// To be added by the next offer.
    Want,
    /// Added by the pending offer.
    Offered(Mid),
    /// Added by the pending offer, but the track was withdrawn meanwhile.
    OfferedWithdrawn(Mid),
    /// Negotiated: packets are forwarded.
    Live(Mid),
    /// Withdrawn: inactive locally, the browser has not been told yet.
    Ending(Mid),
}

/// The payload type a receiver uses for the codec of one incoming payload
/// type, valid until either side negotiates again.
#[derive(Debug, Clone, Copy)]
pub(crate) struct PtCache {
    pub pt_in: str0m::media::Pt,
    pub generation_in: u64,
    pub generation_out: u64,
    pub pt_out: Option<str0m::media::Pt>,
}

/// A send-only section that forwards one track of another session.
#[derive(Debug)]
pub(crate) struct OutSection {
    pub source: TrackKey,
    pub kind: MediaKind,
    pub state: OutState,
    /// Whether a packet has been forwarded yet. The first one asks the
    /// publisher for a keyframe.
    pub started: bool,
    pub rewrite: Rewrite,
    pub pt_cache: Option<PtCache>,
}

impl OutSection {
    pub fn new(source: TrackKey, kind: MediaKind) -> OutSection {
        OutSection {
            source,
            kind,
            state: OutState::Want,
            started: false,
            rewrite: Rewrite::default(),
            pt_cache: None,
        }
    }

    /// The mid of the section in this browser's directory, if it has one.
    pub fn directory_mid(&self) -> Option<Mid> {
        match self.state {
            OutState::Offered(mid) | OutState::Live(mid) => Some(mid),
            _ => None,
        }
    }

    /// Whether the section still stands for its track. One whose track was
    /// withdrawn only waits until the browser has heard of that.
    pub fn is_current(&self) -> bool {
        matches!(
            self.state,
            OutState::Want | OutState::Offered(_) | OutState::Live(_)
        )
    }
}

/// Maps the sequence numbers and timestamps of a publisher onto one
/// receiving section.
///
/// A section starts with the wire sequence number of the first packet it
/// forwards, so it never begins past a rollover the receiver cannot know
/// about. The offset stays constant, so a gap the publisher had is a gap the
/// receiver sees and can ask to be repaired. When the publisher changes its
/// SSRC the section continues where it was instead of jumping.
#[derive(Debug, Default)]
pub(crate) struct Rewrite {
    state: Option<RewriteState>,
}

#[derive(Debug)]
struct RewriteState {
    ssrc: Ssrc,
    seq_offset: i128,
    ts_offset: u32,
    last_seq: u64,
    last_ts: u32,
}

impl Rewrite {
    /// The outgoing sequence number and timestamp of an incoming packet, or
    /// `None` for a packet that would land before the start of the section.
    pub fn map(&mut self, ssrc: Ssrc, seq: u64, ts: u32) -> Option<(u64, u32)> {
        let state = match &mut self.state {
            Some(state) if state.ssrc == ssrc => state,
            Some(state) => {
                state.ssrc = ssrc;
                state.seq_offset = seq as i128 - (state.last_seq as i128 + 1);
                state.ts_offset = state.last_ts.wrapping_add(1).wrapping_sub(ts);
                state
            }
            None => self.state.insert(RewriteState {
                ssrc,
                seq_offset: (seq - u64::from(seq as u16)) as i128,
                ts_offset: 0,
                last_seq: 0,
                last_ts: ts,
            }),
        };

        let out_seq = u64::try_from(seq as i128 - state.seq_offset).ok()?;
        let out_ts = ts.wrapping_add(state.ts_offset);
        if out_seq >= state.last_seq {
            state.last_seq = out_seq;
            state.last_ts = out_ts;
        }
        Some((out_seq, out_ts))
    }
}

/// Packet and byte counts for the stats.
#[derive(Debug, Default, Clone, Copy)]
pub(crate) struct Counter {
    pub packets: u64,
    pub bytes: u64,
}

impl Counter {
    pub fn count(&mut self, bytes: usize) {
        self.packets += 1;
        self.bytes += bytes as u64;
    }
}

/// How many remote addresses one session keeps routed to it: every address
/// its checks may come from. A browser with many interfaces keeps checking its
/// backup pairs from all of them, about every 25 seconds, while its media
/// leaves through one. With fewer routes than addresses, those checks would
/// push out the route of the address that carries the media, whose packets
/// would then be dropped until its own next check, up to 2.5 seconds later.
const MAX_ADDRS: usize = MAX_SOURCE_ADDRS;

pub(crate) struct Session {
    pub key: SessionKey,
    pub id: String,
    pub user_id: String,
    pub room: RoomKey,
    pub rtc: Rtc,
    pub ufrag: String,
    pub created_at: Instant,
    pub transport: Transport,
    pub negotiation: Negotiation,
    pub published: Vec<Published>,
    pub outs: Vec<OutSection>,
    /// The current section of every track this session receives. A section
    /// whose track was withdrawn is not in it any more, so the same track
    /// sent again on the publisher's same section gets a new one while the
    /// old one still waits for its withdrawal to be answered.
    pub out_by_source: HashMap<TrackKey, usize>,
    /// Every mid the media server created in this connection, once the
    /// browser has it. Never forgotten, because sections are not reused.
    pub server_mids: HashSet<Mid>,
    pub ssrc_mids: Vec<(Ssrc, Mid)>,
    /// The codec order of every section in the browser's last offer.
    pub format_orders: FormatOrders,
    /// The Opus parameters the browser gave each section it publishes, in
    /// its last offer.
    pub opus_params: OpusParams,
    pub addrs: VecDeque<SocketAddr>,
    /// Every address a valid check of this browser has come from.
    pub sources: HashSet<SocketAddr>,
    /// Trickled candidates handed to the `Rtc` so far.
    pub remote_candidates: usize,
    pub ingress: Counter,
    pub egress: Counter,
    /// Grows with every completed negotiation, which may move payload types.
    pub generation: u64,
    pub rtc_timeout: Instant,
    /// The earliest time this session is in the timer heap for.
    pub scheduled: Option<Instant>,
}

impl Session {
    pub fn new(
        key: SessionKey,
        id: String,
        user_id: String,
        room: RoomKey,
        rtc: Rtc,
        ufrag: String,
        now: Instant,
    ) -> Session {
        Session {
            key,
            id,
            user_id,
            room,
            rtc,
            ufrag,
            created_at: now,
            transport: Transport {
                ever_connected: false,
                ice: IceConnectionState::New,
                disconnected_since: None,
            },
            negotiation: Negotiation::default(),
            published: Vec::new(),
            outs: Vec::new(),
            out_by_source: HashMap::new(),
            server_mids: HashSet::new(),
            ssrc_mids: Vec::new(),
            format_orders: Vec::new(),
            opus_params: Vec::new(),
            addrs: VecDeque::new(),
            sources: HashSet::new(),
            remote_candidates: 0,
            ingress: Counter::default(),
            egress: Counter::default(),
            generation: 0,
            rtc_timeout: now,
            scheduled: None,
        }
    }

    /// What the media server sends the browser for a description str0m
    /// wrote: every section in the browser's own codec order, and every
    /// section the browser publishes with the browser's own Opus parameters,
    /// which are what its encoder follows.
    pub fn describe(&self, sdp: &str) -> String {
        let ordered = sdp_text::order_formats(sdp, &self.format_orders);
        sdp_text::apply_opus_params(&ordered, &self.opus_params)
    }

    pub fn is_server_mid(&self, mid: &str) -> bool {
        self.server_mids.contains(&Mid::from(mid))
    }

    pub fn state_name(&self) -> &'static str {
        if !self.negotiation.remote_described {
            "new"
        } else if !self.transport.ever_connected {
            "connecting"
        } else if self.transport.disconnected_since.is_some() {
            "disconnected"
        } else {
            "connected"
        }
    }

    /// The earliest moment this session needs attention, if any.
    pub fn deadline(&self) -> Option<Instant> {
        let candidates = [
            self.rtc.is_alive().then_some(self.rtc_timeout),
            (!self.transport.ever_connected).then(|| self.created_at + CONNECT_TIMEOUT),
            self.transport
                .disconnected_since
                .map(|since| since + DISCONNECT_TIMEOUT),
            self.negotiation
                .pending
                .as_ref()
                .map(|p| p.sent_at + OFFER_TIMEOUT),
        ];

        let keyframes = self.published.iter().filter_map(|t| t.keyframe.due());
        candidates.into_iter().flatten().chain(keyframes).min()
    }

    pub fn add_out(&mut self, source: TrackKey, kind: MediaKind) -> bool {
        if self.out_by_source.contains_key(&source) {
            return false;
        }
        self.out_by_source.insert(source, self.outs.len());
        self.outs.push(OutSection::new(source, kind));
        true
    }

    /// Withdraws a track from this receiver. Returns whether the browser has
    /// to be told with an offer.
    pub fn withdraw_out(&mut self, source: TrackKey) -> bool {
        let Some(&idx) = self.out_by_source.get(&source) else {
            return false;
        };
        let out = &mut self.outs[idx];
        match out.state {
            OutState::Want => {
                self.remove_outs(|o| o.source == source && o.state == OutState::Want);
                false
            }
            OutState::Offered(mid) => {
                out.state = OutState::OfferedWithdrawn(mid);
                self.out_by_source.remove(&source);
                false
            }
            OutState::Live(mid) => {
                out.state = OutState::Ending(mid);
                self.out_by_source.remove(&source);
                true
            }
            OutState::OfferedWithdrawn(_) | OutState::Ending(_) => false,
        }
    }

    /// Forgets the sections of an offer that will never be answered.
    pub fn roll_back_offer(&mut self) {
        self.negotiation.pending = None;
        for out in &mut self.outs {
            if let OutState::Offered(_) = out.state {
                out.state = OutState::Want;
            }
        }
        self.remove_outs(|o| matches!(o.state, OutState::OfferedWithdrawn(_)));
    }

    pub fn remove_outs(&mut self, remove: impl Fn(&OutSection) -> bool) {
        let before = self.outs.len();
        self.outs.retain(|o| !remove(o));
        if self.outs.len() != before {
            self.out_by_source = self
                .outs
                .iter()
                .enumerate()
                .filter(|(_, o)| o.is_current())
                .map(|(i, o)| (o.source, i))
                .collect();
        }
    }

    pub fn needs_offer(&self) -> bool {
        self.outs
            .iter()
            .any(|o| matches!(o.state, OutState::Want | OutState::Ending(_)))
    }

    /// Routes a remote address to this session. Returns an address that no
    /// longer is, when the session already had as many as it may.
    pub fn remember_addr(&mut self, addr: SocketAddr) -> Option<SocketAddr> {
        if self.addrs.contains(&addr) {
            return None;
        }
        self.addrs.push_back(addr);
        if self.addrs.len() > MAX_ADDRS {
            self.addrs.pop_front()
        } else {
            None
        }
    }

    pub fn published_mut(&mut self, mid: Mid) -> Option<&mut Published> {
        self.published.iter_mut().find(|t| t.mid == mid)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rewrite_starts_at_the_wire_sequence_number() {
        let mut r = Rewrite::default();
        let ssrc = Ssrc::from(7);

        // A publisher already past several rollovers.
        let first = 5 * 65_536 + 40_000;
        assert_eq!(r.map(ssrc, first, 1000), Some((40_000, 1000)));
        assert_eq!(r.map(ssrc, first + 1, 1960), Some((40_001, 1960)));

        // A gap stays a gap, so the receiver can ask for the packet.
        assert_eq!(r.map(ssrc, first + 5, 5800), Some((40_005, 5800)));
        // The repaired packet lands where it belongs.
        assert_eq!(r.map(ssrc, first + 3, 3880), Some((40_003, 3880)));
    }

    #[test]
    fn rewrite_crosses_a_rollover_without_jumping() {
        let mut r = Rewrite::default();
        let ssrc = Ssrc::from(7);

        assert_eq!(r.map(ssrc, 65_535, 0), Some((65_535, 0)));
        assert_eq!(r.map(ssrc, 65_536, 960), Some((65_536, 960)));
    }

    #[test]
    fn rewrite_drops_what_came_before_the_start() {
        let mut r = Rewrite::default();
        let ssrc = Ssrc::from(7);

        assert_eq!(r.map(ssrc, 65_536 + 2, 0), Some((2, 0)));
        assert_eq!(r.map(ssrc, 65_536 + 1, 0), Some((1, 0)));
        assert_eq!(r.map(ssrc, 65_535, 0), None);
    }

    #[test]
    fn rewrite_continues_across_a_new_ssrc() {
        let mut r = Rewrite::default();

        assert_eq!(r.map(Ssrc::from(1), 100, 9000), Some((100, 9000)));
        assert_eq!(r.map(Ssrc::from(1), 101, 12000), Some((101, 12000)));

        // The new source starts anywhere; the section does not jump.
        assert_eq!(r.map(Ssrc::from(2), 7_000_000, 5), Some((102, 12001)));
        assert_eq!(r.map(Ssrc::from(2), 7_000_001, 3005), Some((103, 15001)));
    }

    #[test]
    fn keyframe_gate_holds_requests_inside_the_window() {
        let now = Instant::now();
        let mut gate = KeyframeGate::default();

        assert!(gate.can_send(now));
        assert_eq!(gate.due(), None);
        gate.hold(KeyframeRequestKind::Pli);
        assert_eq!(gate.due(), None);
        gate.pending = None;

        gate.last = Some(now);
        assert!(!gate.can_send(now + KEYFRAME_INTERVAL / 2));
        gate.hold(KeyframeRequestKind::Pli);
        gate.hold(KeyframeRequestKind::Fir);
        gate.hold(KeyframeRequestKind::Pli);
        assert_eq!(gate.pending, Some(KeyframeRequestKind::Fir));
        assert_eq!(gate.due(), Some(now + KEYFRAME_INTERVAL));
        assert!(gate.can_send(now + KEYFRAME_INTERVAL));
    }
}
