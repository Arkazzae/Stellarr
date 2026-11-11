//! The sans-IO core of the media server.
//!
//! The core owns every room, session, `Rtc`, the directory, forwarding, the
//! limits and the event log. It reads no clock and touches no socket: every
//! entry point takes the current time, datagrams come in through
//! [`Core::handle_datagram`] and leave through [`Core::take_outgoing`]. That
//! is what lets the tests drive whole conversations, ICE and DTLS included,
//! deterministically and faster than real time.

mod session;

use std::cmp::Reverse;
use std::collections::{BinaryHeap, HashMap, VecDeque};
use std::net::SocketAddr;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::Arc;
use std::time::{Duration, Instant};

use rand::Rng;
use serde::Serialize;
use serde_json::{Value, json};
use str0m::change::{SdpAnswer, SdpOffer};
use str0m::crypto::CryptoProvider;
use str0m::format::PayloadParams;
use str0m::media::{Direction, KeyframeRequestKind, MediaKind, Mid};
use str0m::net::{DatagramSend, Protocol, Receive};
use str0m::rtp::{ExtensionValues, RtpPacket, RtpWrite};
use str0m::{Candidate, Event, IceConnectionState, Input, Output, Rtc};
use tracing::{debug, info, warn};

use crate::events::{CloseReason, EventBody, EventLog, Poll, SignalKind};
use crate::sdp_text;
use crate::stun;

use session::{
    Counter, OutState, PendingOffer, PtCache, Published, RoomKey, Session, SessionKey, TrackKey,
};

/// The largest SDP of one signal, in either direction.
pub const MAX_SDP_BYTES: usize = 128 * 1024;
/// How many tracks one session may publish at a time.
pub const MAX_PUBLISHED: usize = 8;
/// How long a new session has to connect.
pub const CONNECT_TIMEOUT: Duration = Duration::from_secs(30);
/// How long a connection that was up may stay down.
pub const DISCONNECT_TIMEOUT: Duration = Duration::from_secs(30);
/// How long a media server offer waits for its answer.
pub const OFFER_TIMEOUT: Duration = Duration::from_secs(10);
/// Unanswered offers in a row after which a session is closed.
pub const MAX_UNANSWERED: u32 = 3;
/// The shortest interval between two keyframe requests for one track.
pub const KEYFRAME_INTERVAL: Duration = Duration::from_secs(1);
/// How many trickled candidates of one browser are handed to its `Rtc`.
pub const MAX_REMOTE_CANDIDATES: usize = 64;
/// How many addresses the checks of one browser may come from over the life
/// of its session.
pub const MAX_SOURCE_ADDRS: usize = 64;

/// The largest datagram the media plane looks at.
const MAX_DATAGRAM: usize = 2048;

/// A request the control API refuses, with the code of the contract.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ApiError {
    InvalidRequest(String),
    UnknownSession,
    InvalidSdp(String),
    LimitExceeded(String),
    StaleNegotiation,
    InvalidCandidate(String),
}

impl ApiError {
    pub fn code(&self) -> &'static str {
        match self {
            ApiError::InvalidRequest(_) => "invalid-request",
            ApiError::UnknownSession => "unknown-session",
            ApiError::InvalidSdp(_) => "invalid-sdp",
            ApiError::LimitExceeded(_) => "limit-exceeded",
            ApiError::StaleNegotiation => "stale-negotiation",
            ApiError::InvalidCandidate(_) => "invalid-candidate",
        }
    }

    pub fn detail(&self) -> String {
        match self {
            ApiError::InvalidRequest(d)
            | ApiError::InvalidSdp(d)
            | ApiError::LimitExceeded(d)
            | ApiError::InvalidCandidate(d) => d.clone(),
            ApiError::UnknownSession => "The media server has no such session.".into(),
            ApiError::StaleNegotiation => {
                "The answer is not for the offer the media server is waiting for.".into()
            }
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct Health {
    pub status: &'static str,
    pub version: &'static str,
    pub epoch: String,
    pub rooms: usize,
    pub sessions: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct ResetReply {
    pub epoch: String,
    pub seq: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Created {
    pub session_id: String,
    pub epoch: String,
}

/// One entry of a session's directory.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub mid: String,
    pub user_id: String,
    pub kind: &'static str,
    pub stream_id: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Stats {
    pub epoch: String,
    pub rooms: Vec<RoomStats>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomStats {
    pub room_id: String,
    pub sessions: Vec<SessionStats>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionStats {
    pub session_id: String,
    pub user_id: String,
    pub state: &'static str,
    pub age_ms: u64,
    pub published: usize,
    pub forwarded: usize,
    pub ingress: Traffic,
    pub egress: Traffic,
}

#[derive(Debug, Clone, Copy, Serialize)]
pub struct Traffic {
    pub packets: u64,
    pub bytes: u64,
}

impl From<Counter> for Traffic {
    fn from(c: Counter) -> Traffic {
        Traffic {
            packets: c.packets,
            bytes: c.bytes,
        }
    }
}

/// A datagram the shell has to send.
#[derive(Debug)]
pub struct Outgoing {
    pub destination: SocketAddr,
    pub contents: DatagramSend,
}

/// Work that touches more than the session whose output produced it. It is
/// queued while that output is drained and done afterwards, so no `Rtc` is
/// ever borrowed twice and every mutation is followed by its own drain.
enum Work {
    Forward {
        from: SessionKey,
        packet: Box<RtpPacket>,
    },
    ReceiverKeyframe {
        receiver: SessionKey,
        mid: Mid,
        kind: KeyframeRequestKind,
    },
    Close {
        key: SessionKey,
        reason: CloseReason,
    },
}

struct Room {
    id: String,
    sessions: Vec<SessionKey>,
}

/// What the core needs besides its own state.
pub struct CoreConfig {
    /// The host candidates of every session, in the order they are
    /// advertised. There must be at least one.
    pub candidates: Vec<SocketAddr>,
}

pub struct Core {
    epoch: String,
    candidates: Vec<SocketAddr>,
    crypto: Arc<CryptoProvider>,
    sessions: HashMap<SessionKey, Session>,
    by_id: HashMap<String, SessionKey>,
    by_user: HashMap<String, SessionKey>,
    by_addr: HashMap<SocketAddr, SessionKey>,
    by_ufrag: HashMap<String, SessionKey>,
    rooms: HashMap<RoomKey, Room>,
    room_by_id: HashMap<String, RoomKey>,
    timers: BinaryHeap<Reverse<(Instant, SessionKey)>>,
    log: EventLog,
    outgoing: Vec<Outgoing>,
    work: VecDeque<Work>,
    next_key: u64,
}

/// Runs one piece of work on a single `Rtc` so that a panic in it ends that
/// session instead of the process. An `Rtc` holds no locks or threads, so
/// dropping one that panicked is safe.
fn guard<T>(f: impl FnOnce() -> T) -> Result<T, ()> {
    catch_unwind(AssertUnwindSafe(f)).map_err(|_| ())
}

pub(crate) fn random_id() -> String {
    let bytes: [u8; 16] = rand::rng().random();
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn is_uuid(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 36
        && bytes.iter().enumerate().all(|(i, b)| match i {
            8 | 13 | 18 | 23 => *b == b'-',
            _ => b.is_ascii_hexdigit(),
        })
}

fn kind_name(kind: MediaKind) -> &'static str {
    match kind {
        MediaKind::Audio => "audio",
        MediaKind::Video => "video",
    }
}

/// Whether a browser candidate is well formed but of a kind this media
/// server cannot use: mDNS host names, IPv6 and TCP. These are accepted and
/// ignored, because a browser sends them as a matter of course and the media
/// server, being ICE-lite, learns the browser's address from its checks
/// anyway.
fn is_unusable_candidate(line: &str) -> bool {
    let line = line.trim().strip_prefix("a=").unwrap_or(line.trim());
    let tokens: Vec<&str> = line.split_whitespace().collect();
    if tokens.len() < 8 || !tokens[0].starts_with("candidate:") {
        return false;
    }
    let transport = tokens[2];
    let address = tokens[4];
    !transport.eq_ignore_ascii_case("udp")
        || address.ends_with(".local")
        || address.parse::<std::net::Ipv6Addr>().is_ok()
}

/// Everything a drain may need besides the session itself.
struct Ctx<'a> {
    outgoing: &'a mut Vec<Outgoing>,
    work: &'a mut VecDeque<Work>,
    timers: &'a mut BinaryHeap<Reverse<(Instant, SessionKey)>>,
}

impl Ctx<'_> {
    /// Drains one `Rtc` until it has nothing more to say, as str0m requires
    /// after every mutation.
    fn drain(&mut self, s: &mut Session, now: Instant) {
        let key = s.key;
        let result = guard(|| {
            loop {
                match s.rtc.poll_output() {
                    Ok(Output::Timeout(t)) => {
                        s.rtc_timeout = t;
                        return Ok(());
                    }
                    Ok(Output::Transmit(t)) => self.outgoing.push(Outgoing {
                        destination: t.destination,
                        contents: t.contents,
                    }),
                    Ok(Output::Event(e)) => on_event(s, e, now, self.work),
                    Err(e) => return Err(e),
                }
            }
        });

        match result {
            Ok(Ok(())) => {}
            Ok(Err(e)) => {
                warn!(session = %s.id, error = %e, "the connection failed");
                self.work.push_back(Work::Close {
                    key,
                    reason: CloseReason::Error,
                });
            }
            Err(()) => {
                warn!(session = %s.id, "the connection panicked while draining");
                self.work.push_back(Work::Close {
                    key,
                    reason: CloseReason::Error,
                });
            }
        }
        self.reschedule(s);
    }

    /// Puts the session in the timer heap when it now needs attention
    /// earlier than it is scheduled for. A later deadline needs no new
    /// entry: the earlier one fires, finds nothing to do, and schedules the
    /// real one.
    fn reschedule(&mut self, s: &mut Session) {
        let Some(deadline) = s.deadline() else {
            return;
        };
        if s.scheduled.is_none_or(|t| deadline < t) {
            s.scheduled = Some(deadline);
            self.timers.push(Reverse((deadline, s.key)));
        }
    }

    /// Feeds the current time to a session's `Rtc` and drains it.
    fn tick(&mut self, s: &mut Session, now: Instant) {
        match guard(|| s.rtc.handle_input(Input::Timeout(now))) {
            Ok(Ok(())) => {}
            Ok(Err(e)) => debug!(session = %s.id, error = %e, "timeout handling failed"),
            Err(()) => {
                self.work.push_back(Work::Close {
                    key: s.key,
                    reason: CloseReason::Error,
                });
                return;
            }
        }
        self.drain(s, now);
    }
}

fn on_event(s: &mut Session, event: Event, now: Instant, work: &mut VecDeque<Work>) {
    match event {
        Event::Connected => {
            if !s.transport.ever_connected {
                info!(session = %s.id, "connected");
            }
            s.transport.ever_connected = true;
            s.transport.disconnected_since = None;
        }
        Event::IceConnectionStateChange(state) => {
            s.transport.ice = state;
            match state {
                IceConnectionState::Connected | IceConnectionState::Completed => {
                    if s.transport.ever_connected {
                        s.transport.disconnected_since = None;
                    }
                }
                IceConnectionState::Disconnected => {
                    if s.transport.ever_connected && s.transport.disconnected_since.is_none() {
                        info!(session = %s.id, "disconnected");
                        s.transport.disconnected_since = Some(now);
                    }
                }
                IceConnectionState::New | IceConnectionState::Checking => {}
            }
        }
        Event::Closed => {
            // The browser closed its end. Until the API closes the session,
            // it is a connection that is down like any other.
            if s.transport.disconnected_since.is_none() {
                s.transport.disconnected_since = Some(now);
            }
        }
        Event::RtpPacket(packet) => work.push_back(Work::Forward {
            from: s.key,
            packet: Box::new(packet),
        }),
        Event::KeyframeRequest(request) => work.push_back(Work::ReceiverKeyframe {
            receiver: s.key,
            mid: request.mid,
            kind: request.kind,
        }),
        _ => {}
    }
}

impl Core {
    pub fn new(config: CoreConfig, epoch: String) -> Core {
        assert!(
            !config.candidates.is_empty(),
            "the media server needs a candidate to advertise"
        );

        Core {
            log: EventLog::new(epoch.clone()),
            epoch,
            candidates: config.candidates,
            crypto: Arc::new(str0m::crypto::from_feature_flags()),
            sessions: HashMap::new(),
            by_id: HashMap::new(),
            by_user: HashMap::new(),
            by_addr: HashMap::new(),
            by_ufrag: HashMap::new(),
            rooms: HashMap::new(),
            room_by_id: HashMap::new(),
            timers: BinaryHeap::new(),
            outgoing: Vec::new(),
            work: VecDeque::new(),
            next_key: 1,
        }
    }

    pub fn epoch(&self) -> &str {
        &self.epoch
    }

    pub fn has_session(&self, session_id: &str) -> bool {
        self.by_id.contains_key(session_id)
    }

    /// The sequence number of the newest event.
    pub fn last_seq(&self) -> u64 {
        self.log.last_seq()
    }

    /// The datagrams produced since the last call, to be sent in order.
    pub fn take_outgoing(&mut self) -> Vec<Outgoing> {
        std::mem::take(&mut self.outgoing)
    }

    /// When [`Core::handle_timeout`] should be called next.
    pub fn poll_timeout(&self) -> Option<Instant> {
        self.timers.peek().map(|Reverse((t, _))| *t)
    }

    fn ctx(&mut self) -> (Ctx<'_>, &mut HashMap<SessionKey, Session>) {
        (
            Ctx {
                outgoing: &mut self.outgoing,
                work: &mut self.work,
                timers: &mut self.timers,
            },
            &mut self.sessions,
        )
    }

    fn build_rtc(&self, now: Instant) -> Rtc {
        Rtc::builder()
            .set_crypto_provider(self.crypto.clone())
            .set_ice_lite(true)
            .set_rtp_mode(true)
            .clear_codecs()
            .enable_opus(true, false)
            .enable_vp9(true)
            .enable_vp8(true)
            .enable_h264(true)
            .enable_av1(true)
            .build(now)
    }

    // ---------------------------------------------------------------- control

    pub fn health(&self) -> Health {
        Health {
            status: "ok",
            version: env!("CARGO_PKG_VERSION"),
            epoch: self.epoch.clone(),
            rooms: self.rooms.len(),
            sessions: self.sessions.len(),
        }
    }

    /// Closes every session without events, as the API does when it starts
    /// with no seats.
    pub fn reset(&mut self, now: Instant) -> ResetReply {
        let keys: Vec<SessionKey> = self.sessions.keys().copied().collect();
        for key in keys {
            self.close(now, key, None, false);
        }
        self.work.clear();
        info!("reset: every session closed");

        ResetReply {
            epoch: self.epoch.clone(),
            seq: self.log.last_seq(),
        }
    }

    pub fn create_session(
        &mut self,
        now: Instant,
        room_id: &str,
        user_id: &str,
    ) -> Result<Created, ApiError> {
        if !is_uuid(room_id) {
            return Err(ApiError::InvalidRequest("roomId must be a uuid.".into()));
        }
        if !is_uuid(user_id) {
            return Err(ApiError::InvalidRequest("userId must be a uuid.".into()));
        }

        // One session per account: a new one replaces the old one silently.
        if let Some(&old) = self.by_user.get(user_id) {
            self.close(now, old, None, true);
        }

        let key = SessionKey(self.next_key);
        self.next_key += 1;
        let id = random_id();

        let room = match self.room_by_id.get(room_id) {
            Some(&room) => room,
            None => {
                let room = RoomKey(key.0);
                self.room_by_id.insert(room_id.to_string(), room);
                self.rooms.insert(
                    room,
                    Room {
                        id: room_id.to_string(),
                        sessions: Vec::new(),
                    },
                );
                room
            }
        };

        let mut rtc = self.build_rtc(now);
        let ufrag = rtc.direct_api().local_ice_credentials().ufrag;
        let mut session = Session::new(
            key,
            id.clone(),
            user_id.to_string(),
            room,
            rtc,
            ufrag.clone(),
            now,
        );

        // The new session receives everything the room already publishes.
        let room_sessions = self.rooms[&room].sessions.clone();
        for other in &room_sessions {
            if let Some(publisher) = self.sessions.get(other) {
                for track in &publisher.published {
                    session.add_out(
                        TrackKey {
                            session: *other,
                            mid: track.mid,
                        },
                        track.kind,
                    );
                }
            }
        }

        let candidates = self.candidates.clone();
        let (mut ctx, _) = self.ctx();
        for addr in candidates {
            if let Ok(candidate) = Candidate::host(addr, "udp") {
                session.rtc.add_local_candidate(candidate);
                ctx.drain(&mut session, now);
            }
        }
        ctx.reschedule(&mut session);

        self.by_id.insert(id.clone(), key);
        self.by_user.insert(user_id.to_string(), key);
        self.by_ufrag.insert(ufrag, key);
        self.sessions.insert(key, session);
        if let Some(r) = self.rooms.get_mut(&room) {
            r.sessions.push(key);
        }
        info!(session = %id, room = %room_id, user = %user_id, "session created");

        self.run_work(now);
        Ok(Created {
            session_id: id,
            epoch: self.epoch.clone(),
        })
    }

    /// Closes a session through the control API: never with an event.
    pub fn delete_session(&mut self, now: Instant, session_id: &str) {
        if let Some(&key) = self.by_id.get(session_id) {
            self.close(now, key, None, true);
        }
        self.run_work(now);
    }

    pub fn offer(&mut self, now: Instant, session_id: &str, sdp: &str) -> Result<(), ApiError> {
        let key = *self.by_id.get(session_id).ok_or(ApiError::UnknownSession)?;
        let result = self.accept_browser_offer(now, key, sdp);
        self.run_work(now);
        result
    }

    pub fn answer(
        &mut self,
        now: Instant,
        session_id: &str,
        sdp: &str,
        negotiation_id: u64,
    ) -> Result<(), ApiError> {
        let key = *self.by_id.get(session_id).ok_or(ApiError::UnknownSession)?;
        let result = self.accept_browser_answer(now, key, sdp, negotiation_id);
        self.run_work(now);
        result
    }

    /// A trickled browser candidate, or `None` for end-of-candidates.
    pub fn candidate(
        &mut self,
        now: Instant,
        session_id: &str,
        candidate: Option<&Value>,
    ) -> Result<(), ApiError> {
        let key = *self.by_id.get(session_id).ok_or(ApiError::UnknownSession)?;

        let Some(value) = candidate else {
            return Ok(());
        };
        let Some(line) = value.get("candidate").and_then(Value::as_str) else {
            return Err(ApiError::InvalidCandidate(
                "candidate must be null or an object with a candidate string.".into(),
            ));
        };
        // Some browsers end their candidates with an empty one.
        if line.trim().is_empty() || is_unusable_candidate(line) {
            return Ok(());
        }
        let candidate: Candidate = serde_json::from_value(value.clone())
            .map_err(|e| ApiError::InvalidCandidate(format!("{e}")))?;

        let (mut ctx, sessions) = self.ctx();
        if let Some(s) = sessions.get_mut(&key) {
            // A browser has a handful of candidates, and an ICE-lite server
            // learns the addresses it uses from its checks anyway. str0m keeps
            // every candidate it is given and compares each new one with all
            // of them, so without a limit one browser could grow its session
            // and slow the media task of every room. Later ones are ignored.
            if s.remote_candidates >= MAX_REMOTE_CANDIDATES {
                debug!(session = %s.id, "ignored a candidate past the limit");
                return Ok(());
            }
            s.remote_candidates += 1;
            if guard(|| s.rtc.add_remote_candidate(candidate)).is_err() {
                ctx.work.push_back(Work::Close {
                    key,
                    reason: CloseReason::Error,
                });
            } else {
                ctx.drain(s, now);
            }
        }

        self.run_work(now);
        Ok(())
    }

    pub fn events(&self, epoch: Option<&str>, after: u64) -> Poll {
        self.log.read(epoch, after)
    }

    pub fn stats(&self, now: Instant) -> Stats {
        let mut rooms: Vec<RoomStats> = self
            .rooms
            .values()
            .map(|room| RoomStats {
                room_id: room.id.clone(),
                sessions: room
                    .sessions
                    .iter()
                    .filter_map(|k| self.sessions.get(k))
                    .map(|s| SessionStats {
                        session_id: s.id.clone(),
                        user_id: s.user_id.clone(),
                        state: s.state_name(),
                        age_ms: now.saturating_duration_since(s.created_at).as_millis() as u64,
                        published: s.published.len(),
                        forwarded: s
                            .outs
                            .iter()
                            .filter(|o| matches!(o.state, OutState::Live(_)))
                            .count(),
                        ingress: s.ingress.into(),
                        egress: s.egress.into(),
                    })
                    .collect(),
            })
            .collect();
        rooms.sort_by(|a, b| a.room_id.cmp(&b.room_id));

        Stats {
            epoch: self.epoch.clone(),
            rooms,
        }
    }

    /// The directory of a session: every section it receives, named after
    /// the person who publishes it.
    pub fn directory(&self, session_id: &str) -> Option<Vec<Track>> {
        let key = self.by_id.get(session_id)?;
        Some(self.directory_of(*key))
    }

    fn directory_of(&self, key: SessionKey) -> Vec<Track> {
        let Some(s) = self.sessions.get(&key) else {
            return Vec::new();
        };
        s.outs
            .iter()
            .filter_map(|out| {
                let mid = out.directory_mid()?;
                let publisher = self.sessions.get(&out.source.session)?;
                let track = publisher
                    .published
                    .iter()
                    .find(|t| t.mid == out.source.mid)?;
                Some(Track {
                    mid: mid.to_string(),
                    user_id: publisher.user_id.clone(),
                    kind: kind_name(out.kind),
                    stream_id: track.stream_id.clone(),
                })
            })
            .collect()
    }

    fn signal(&mut self, key: SessionKey, kind: SignalKind, payload: Value) {
        let Some(s) = self.sessions.get(&key) else {
            return;
        };
        let session_id = s.id.clone();
        self.log.push(EventBody::Signal {
            session_id,
            kind,
            payload,
        });
    }

    fn send_tracks(&mut self, key: SessionKey) {
        let tracks = self.directory_of(key);
        self.signal(key, SignalKind::Tracks, json!({ "tracks": tracks }));
    }

    // ------------------------------------------------------------ negotiation

    fn accept_browser_offer(
        &mut self,
        now: Instant,
        key: SessionKey,
        sdp: &str,
    ) -> Result<(), ApiError> {
        if sdp.len() > MAX_SDP_BYTES {
            return Err(ApiError::InvalidSdp(
                "The description is larger than 128 KiB.".into(),
            ));
        }
        SdpOffer::from_sdp_string(sdp).map_err(|e| ApiError::InvalidSdp(format!("{e}")))?;
        // str0m tears the connection down when the first description it
        // gets has no fingerprint; refusing it here keeps the session usable.
        if !sdp_text::has_fingerprint(sdp) {
            return Err(ApiError::InvalidSdp(
                "The description has no a=fingerprint.".into(),
            ));
        }

        let s = self
            .sessions
            .get_mut(&key)
            .ok_or(ApiError::UnknownSession)?;
        let sections = sdp_text::sections(sdp);
        let published = sdp_text::count_published(&sections, |mid| s.is_server_mid(mid));
        if published > MAX_PUBLISHED {
            return Err(ApiError::LimitExceeded(format!(
                "The description publishes {published} tracks; at most {MAX_PUBLISHED} are allowed."
            )));
        }
        let narrowed = sdp_text::narrow_offer_directions(sdp, |mid| s.is_server_mid(mid));
        let offer = SdpOffer::from_sdp_string(&narrowed)
            .map_err(|e| ApiError::InvalidSdp(format!("{e}")))?;

        // The media server is the polite side of a collision: its own offer
        // is rolled back, the browser's is answered, and it offers again.
        if s.negotiation.pending.is_some() {
            debug!(session = %s.id, "offer collision: rolling back");
            s.roll_back_offer();
        }

        let accepted = guard(|| s.rtc.sdp_api().accept_offer(offer));
        let (mut ctx, sessions) = self.ctx();
        let s = sessions
            .get_mut(&key)
            .expect("the session was looked up above");
        let answer = match accepted {
            Ok(Ok(answer)) => answer,
            Ok(Err(e)) => {
                ctx.drain(s, now);
                if !s.rtc.is_alive() {
                    ctx.work.push_back(Work::Close {
                        key,
                        reason: CloseReason::Error,
                    });
                }
                warn!(session = %s.id, error = %e, "refused a browser offer");
                let refused = ApiError::InvalidSdp(format!("{e}"));
                // A rolled back offer of ours is still owed.
                self.maybe_offer(now, key);
                return Err(refused);
            }
            Err(()) => {
                ctx.work.push_back(Work::Close {
                    key,
                    reason: CloseReason::Error,
                });
                return Err(ApiError::InvalidSdp(
                    "The description could not be applied.".into(),
                ));
            }
        };

        s.format_orders = sdp_text::format_orders(&narrowed);
        let opus_params = sdp_text::opus_params(&narrowed, |mid| !s.is_server_mid(mid));
        s.opus_params = opus_params;
        let answer_sdp = s.describe(&answer.to_sdp_string());

        // A browser that restarts ICE gets new credentials from str0m, and
        // its first checks after that are routed by them.
        let ufrag = s.rtc.direct_api().local_ice_credentials().ufrag;
        let restarted = (ufrag != s.ufrag).then(|| std::mem::replace(&mut s.ufrag, ufrag.clone()));
        s.negotiation.remote_described = true;
        s.negotiation.unanswered = 0;
        s.generation += 1;
        ctx.drain(s, now);

        if answer_sdp.len() > MAX_SDP_BYTES {
            warn!(session = %s.id, "the answer would exceed 128 KiB");
            ctx.work.push_back(Work::Close {
                key,
                reason: CloseReason::Error,
            });
            return Ok(());
        }

        // The answer tells the browser about every section that is inactive,
        // so withdrawals still owed to it are settled.
        let settled: Vec<Mid> = s
            .outs
            .iter()
            .filter_map(|o| match o.state {
                OutState::Ending(mid) => s
                    .rtc
                    .media(mid)
                    .is_none_or(|m| m.direction() == Direction::Inactive)
                    .then_some(mid),
                _ => None,
            })
            .collect();
        s.remove_outs(|o| matches!(o.state, OutState::Ending(mid) if settled.contains(&mid)));

        // What the browser publishes now.
        let mut added = Vec::new();
        let mut withdrawn = Vec::new();
        let mut restreamed = Vec::new();
        let mut seen = Vec::new();
        for section in sections
            .iter()
            .filter(|x| x.kind != sdp_text::SectionKind::Other)
        {
            if s.is_server_mid(&section.mid) {
                continue;
            }
            let mid = Mid::from(section.mid.as_str());
            seen.push(mid);
            let media = s.rtc.media(mid);
            let sending = media.is_some_and(|m| m.direction().is_receiving() && !m.disabled());
            let kind = media.map_or(MediaKind::Audio, |m| m.kind());
            let stream_id = section.stream_id.clone().unwrap_or_default();

            match (s.published_mut(mid), sending) {
                (None, true) => {
                    s.published.push(Published {
                        mid,
                        kind,
                        stream_id,
                        keyframe: Default::default(),
                    });
                    added.push((mid, kind));
                }
                (Some(_), false) => withdrawn.push(mid),
                (Some(track), true) if track.stream_id != stream_id => {
                    track.stream_id = stream_id;
                    restreamed.push(mid);
                }
                _ => {}
            }
        }
        for track in &s.published {
            if !seen.contains(&track.mid) && !withdrawn.contains(&track.mid) {
                withdrawn.push(track.mid);
            }
        }
        s.published.retain(|t| !withdrawn.contains(&t.mid));
        info!(
            session = %s.id,
            published = s.published.len(),
            added = added.len(),
            withdrawn = withdrawn.len(),
            restreamed = restreamed.len(),
            "answered a browser offer"
        );

        if let Some(old_ufrag) = restarted {
            self.by_ufrag.remove(&old_ufrag);
            self.by_ufrag.insert(ufrag, key);
        }

        self.signal(
            key,
            SignalKind::Answer,
            json!({ "type": "answer", "sdp": answer_sdp }),
        );

        let room = self.sessions[&key].room;
        let others: Vec<SessionKey> = self
            .rooms
            .get(&room)
            .map_or(Vec::new(), |r| r.sessions.clone());
        for other in others.into_iter().filter(|o| *o != key) {
            let Some(o) = self.sessions.get_mut(&other) else {
                continue;
            };
            let mut changed = false;
            for (mid, kind) in &added {
                changed |= o.add_out(
                    TrackKey {
                        session: key,
                        mid: *mid,
                    },
                    *kind,
                );
            }
            for mid in &withdrawn {
                changed |= o.withdraw_out(TrackKey {
                    session: key,
                    mid: *mid,
                });
            }
            let names_restreamed = restreamed.iter().any(|mid| {
                o.out_by_source
                    .get(&TrackKey {
                        session: key,
                        mid: *mid,
                    })
                    .is_some_and(|i| o.outs[*i].directory_mid().is_some())
            });

            let offered = changed && self.maybe_offer(now, other);
            // A new stream id alone needs no SDP exchange, only the directory.
            if names_restreamed && !offered {
                self.send_tracks(other);
            }
        }

        self.maybe_offer(now, key);
        Ok(())
    }

    fn accept_browser_answer(
        &mut self,
        now: Instant,
        key: SessionKey,
        sdp: &str,
        negotiation_id: u64,
    ) -> Result<(), ApiError> {
        let s = self
            .sessions
            .get_mut(&key)
            .ok_or(ApiError::UnknownSession)?;
        if s.negotiation
            .pending
            .as_ref()
            .is_none_or(|p| p.id != negotiation_id)
        {
            return Err(ApiError::StaleNegotiation);
        }
        if sdp.len() > MAX_SDP_BYTES {
            return Err(ApiError::InvalidSdp(
                "The description is larger than 128 KiB.".into(),
            ));
        }
        // Parsed before the pending offer is spent, so a malformed answer
        // leaves the offer waiting for a good one.
        let answer =
            SdpAnswer::from_sdp_string(sdp).map_err(|e| ApiError::InvalidSdp(format!("{e}")))?;

        let pending = s.negotiation.pending.take().expect("checked above");
        let inactive = pending.inactive;
        let accepted = guard(|| s.rtc.sdp_api().accept_answer(pending.pending, answer));

        let (mut ctx, sessions) = self.ctx();
        let s = sessions
            .get_mut(&key)
            .expect("the session was looked up above");
        match accepted {
            Ok(Ok(())) => {}
            Ok(Err(e)) => {
                warn!(session = %s.id, error = %e, "refused a browser answer");
                s.roll_back_offer();
                ctx.drain(s, now);
                if !s.rtc.is_alive() {
                    ctx.work.push_back(Work::Close {
                        key,
                        reason: CloseReason::Error,
                    });
                } else {
                    self.maybe_offer(now, key);
                }
                return Err(ApiError::InvalidSdp(format!("{e}")));
            }
            Err(()) => {
                ctx.work.push_back(Work::Close {
                    key,
                    reason: CloseReason::Error,
                });
                return Err(ApiError::InvalidSdp(
                    "The description could not be applied.".into(),
                ));
            }
        }

        for out in &mut s.outs {
            match out.state {
                OutState::Offered(mid) => {
                    out.state = OutState::Live(mid);
                    s.server_mids.insert(mid);
                }
                OutState::OfferedWithdrawn(mid) => {
                    out.state = OutState::Ending(mid);
                    s.server_mids.insert(mid);
                }
                _ => {}
            }
        }
        s.remove_outs(|o| matches!(o.state, OutState::Ending(mid) if inactive.contains(&mid)));
        s.negotiation.unanswered = 0;
        s.generation += 1;
        ctx.drain(s, now);
        debug!(session = %s.id, negotiation = negotiation_id, "accepted a browser answer");

        self.maybe_offer(now, key);
        Ok(())
    }

    /// Offers the browser whatever changed in what it receives, unless an
    /// offer is already waiting for its answer. Returns whether it offered.
    fn maybe_offer(&mut self, now: Instant, key: SessionKey) -> bool {
        let Some(s) = self.sessions.get(&key) else {
            return false;
        };
        if !s.negotiation.remote_described
            || s.negotiation.pending.is_some()
            || !s.rtc.is_alive()
            || !s.needs_offer()
        {
            return false;
        }

        // A new section carries the publisher's current stream id in its
        // msid, which keeps the picture and sound of one share in step.
        let wants: Vec<(usize, MediaKind, String)> = s
            .outs
            .iter()
            .enumerate()
            .filter(|(_, o)| o.state == OutState::Want)
            .map(|(i, o)| {
                let stream = self
                    .sessions
                    .get(&o.source.session)
                    .and_then(|p| p.published.iter().find(|t| t.mid == o.source.mid))
                    .map(|t| t.stream_id.clone())
                    .filter(|id| !id.is_empty())
                    .unwrap_or_else(|| "-".into());
                (i, o.kind, stream)
            })
            .collect();
        let endings: Vec<(Mid, bool)> = s
            .outs
            .iter()
            .filter_map(|o| match o.state {
                OutState::Ending(mid) => {
                    let inactive = s
                        .rtc
                        .media(mid)
                        .is_none_or(|m| m.direction() == Direction::Inactive);
                    Some((mid, inactive))
                }
                _ => None,
            })
            .collect();

        let (mut ctx, sessions) = self.ctx();
        let s = sessions
            .get_mut(&key)
            .expect("the session was looked up above");
        let applied = guard(|| {
            let mut api = s.rtc.sdp_api();
            let mids: Vec<Mid> = wants
                .iter()
                .map(|(_, kind, stream)| {
                    api.add_media(*kind, Direction::SendOnly, Some(stream.clone()), None, None)
                })
                .collect();
            for (mid, inactive) in &endings {
                // str0m applies a direction to the session at once, so after a
                // rolled back offer the section is already inactive and
                // setting it again would be no change at all. Going through
                // another direction makes it a change the offer carries.
                if *inactive {
                    api.set_direction(*mid, Direction::SendOnly);
                }
                api.set_direction(*mid, Direction::Inactive);
            }
            (mids, api.apply())
        });

        let (mids, offer, pending) = match applied {
            Ok((mids, Some((offer, pending)))) => (mids, offer, pending),
            Ok((_, None)) => {
                // Nothing str0m would negotiate: the withdrawn sections are
                // gone from the session already.
                s.remove_outs(|o| matches!(o.state, OutState::Ending(_)));
                ctx.drain(s, now);
                return false;
            }
            Err(()) => {
                ctx.work.push_back(Work::Close {
                    key,
                    reason: CloseReason::Error,
                });
                return false;
            }
        };

        for ((idx, _, _), mid) in wants.iter().zip(mids) {
            s.outs[*idx].state = OutState::Offered(mid);
        }
        let sdp = s.describe(&offer.to_sdp_string());
        if sdp.len() > MAX_SDP_BYTES {
            warn!(session = %s.id, "the media server's offer would exceed 128 KiB");
            drop(pending);
            ctx.work.push_back(Work::Close {
                key,
                reason: CloseReason::Error,
            });
            return false;
        }

        s.negotiation.last_id += 1;
        let id = s.negotiation.last_id;
        s.negotiation.pending = Some(PendingOffer {
            id,
            pending,
            sent_at: now,
            inactive: endings.iter().map(|(mid, _)| *mid).collect(),
        });
        ctx.drain(s, now);
        debug!(session = %s.id, negotiation = id, "offering");

        let tracks = self.directory_of(key);
        self.signal(
            key,
            SignalKind::Offer,
            json!({ "type": "offer", "sdp": sdp, "negotiationId": id, "tracks": tracks }),
        );
        true
    }

    // ------------------------------------------------------------ media plane

    /// One datagram from the shared socket.
    ///
    /// One socket cannot tell which advertised address a datagram was sent
    /// to, and str0m only answers a connectivity check that arrived on one of
    /// its local candidates. Every datagram is therefore handed to str0m as
    /// if it had arrived on the first advertised candidate. That is never a
    /// lie that matters: the reply leaves through the same socket whatever
    /// str0m thinks its source is, and a NAT in front of the socket maps it
    /// back to the address the browser used.
    pub fn handle_datagram(&mut self, now: Instant, source: SocketAddr, buf: &[u8]) {
        if buf.is_empty() || buf.len() > MAX_DATAGRAM || !source.is_ipv4() {
            return;
        }
        let Ok(receive) = Receive::new(Protocol::Udp, source, self.candidates[0], buf) else {
            return;
        };
        let input = Input::Receive(now, receive);

        let Some(key) = self.route(source, buf, &input) else {
            return;
        };

        let (mut ctx, sessions) = self.ctx();
        let s = sessions
            .get_mut(&key)
            .expect("routed to an existing session");
        match guard(|| s.rtc.handle_input(input)) {
            Ok(Ok(())) => {}
            Ok(Err(e)) => debug!(session = %s.id, error = %e, "a datagram was refused"),
            Err(()) => {
                warn!(session = %s.id, "the connection panicked on a datagram");
                ctx.work.push_back(Work::Close {
                    key,
                    reason: CloseReason::Error,
                });
            }
        }
        ctx.drain(s, now);
        if !s.rtc.is_alive() && s.transport.disconnected_since.is_none() {
            s.transport.disconnected_since = Some(now);
            ctx.reschedule(s);
        }

        self.run_work(now);
    }

    /// Which session a datagram belongs to: by the remote address once it is
    /// known, and before that by the ICE credentials of a connectivity check.
    fn route(&mut self, source: SocketAddr, buf: &[u8], input: &Input) -> Option<SessionKey> {
        if let Some(&key) = self.by_addr.get(&source)
            && self
                .sessions
                .get(&key)
                .is_some_and(|s| s.rtc.accepts(input))
        {
            return Some(key);
        }

        let ufrag = stun::local_ufrag(buf)?;
        let key = *self.by_ufrag.get(ufrag)?;
        let s = self.sessions.get_mut(&key)?;
        if !s.rtc.accepts(input) {
            return None;
        }
        // Every new address a valid check comes from becomes a remote
        // candidate that str0m keeps for the life of the session and compares
        // each later check with. A browser uses a handful; whoever holds the
        // session's credentials could otherwise send one check from as many
        // addresses as it likes and slow the media task of every room.
        if !s.sources.contains(&source) {
            if s.sources.len() >= MAX_SOURCE_ADDRS {
                debug!(session = %s.id, "ignored a check from one address too many");
                return None;
            }
            s.sources.insert(source);
        }

        // The latest check with valid credentials decides who owns an address.
        if let Some(previous) = self.by_addr.insert(source, key)
            && previous != key
            && let Some(p) = self.sessions.get_mut(&previous)
        {
            p.addrs.retain(|a| *a != source);
        }
        let s = self.sessions.get_mut(&key)?;
        if let Some(evicted) = s.remember_addr(source)
            && self.by_addr.get(&evicted) == Some(&key)
        {
            self.by_addr.remove(&evicted);
        }
        Some(key)
    }

    pub fn handle_timeout(&mut self, now: Instant) {
        // What is due is taken out first and handled once. A session that is
        // due again at once after its turn waits for the next call, so a
        // timeout that does not move cannot hold the media task in this loop.
        let mut due = Vec::new();
        while let Some(Reverse((t, key))) = self.timers.peek().copied() {
            if t > now {
                break;
            }
            self.timers.pop();
            let Some(s) = self.sessions.get_mut(&key) else {
                continue;
            };
            if s.scheduled != Some(t) {
                continue;
            }
            s.scheduled = None;
            due.push(key);
        }
        for key in due {
            self.on_session_timer(now, key);
        }
        self.run_work(now);
    }

    fn on_session_timer(&mut self, now: Instant, key: SessionKey) {
        let Some(s) = self.sessions.get_mut(&key) else {
            return;
        };

        if !s.transport.ever_connected && now >= s.created_at + CONNECT_TIMEOUT {
            info!(session = %s.id, "never connected");
            self.close(now, key, Some(CloseReason::TransportTimeout), true);
            return;
        }
        if s.transport
            .disconnected_since
            .is_some_and(|since| now >= since + DISCONNECT_TIMEOUT)
        {
            info!(session = %s.id, "stayed disconnected");
            self.close(now, key, Some(CloseReason::TransportTimeout), true);
            return;
        }

        let (mut ctx, sessions) = self.ctx();
        let s = sessions.get_mut(&key).expect("looked up above");
        if s.rtc.is_alive() && s.rtc_timeout <= now {
            ctx.tick(s, now);
        }

        if s.negotiation
            .pending
            .as_ref()
            .is_some_and(|p| now >= p.sent_at + OFFER_TIMEOUT)
        {
            s.roll_back_offer();
            s.negotiation.unanswered += 1;
            info!(session = %s.id, unanswered = s.negotiation.unanswered, "an offer went unanswered");
            if s.negotiation.unanswered >= MAX_UNANSWERED {
                self.close(now, key, Some(CloseReason::Error), true);
                return;
            }
            self.maybe_offer(now, key);
        }

        let due: Vec<(Mid, KeyframeRequestKind)> =
            self.sessions.get(&key).map_or(Vec::new(), |s| {
                s.published
                    .iter()
                    .filter_map(|t| {
                        let kind = t.keyframe.pending?;
                        t.keyframe.can_send(now).then_some((t.mid, kind))
                    })
                    .collect()
            });
        for (mid, kind) in due {
            self.request_keyframe(now, key, mid, kind);
        }

        let (mut ctx, sessions) = self.ctx();
        if let Some(s) = sessions.get_mut(&key) {
            ctx.reschedule(s);
        }
    }

    fn run_work(&mut self, now: Instant) {
        while let Some(work) = self.work.pop_front() {
            match work {
                Work::Forward { from, packet } => self.forward(now, from, &packet),
                Work::ReceiverKeyframe {
                    receiver,
                    mid,
                    kind,
                } => {
                    let source = self.sessions.get(&receiver).and_then(|s| {
                        s.outs
                            .iter()
                            .find(|o| o.state == OutState::Live(mid))
                            .map(|o| o.source)
                    });
                    if let Some(source) = source {
                        self.request_keyframe(now, source.session, source.mid, kind);
                    }
                }
                Work::Close { key, reason } => self.close(now, key, Some(reason), true),
            }
        }
    }

    /// Asks a publisher for a keyframe of one track, at most once per second.
    fn request_keyframe(
        &mut self,
        now: Instant,
        publisher: SessionKey,
        mid: Mid,
        kind: KeyframeRequestKind,
    ) {
        let (mut ctx, sessions) = self.ctx();
        let Some(p) = sessions.get_mut(&publisher) else {
            return;
        };
        let Some(track) = p.published_mut(mid) else {
            return;
        };
        if track.kind != MediaKind::Video {
            return;
        }
        if !track.keyframe.can_send(now) {
            track.keyframe.hold(kind);
            ctx.reschedule(p);
            return;
        }

        let sent = guard(|| {
            let mut api = p.rtc.direct_api();
            match api.stream_rx_by_mid(mid, None) {
                Some(stream) => {
                    stream.request_keyframe(kind);
                    true
                }
                None => false,
            }
        });
        match sent {
            Ok(true) => {
                if let Some(track) = p.published_mut(mid) {
                    track.keyframe.last = Some(now);
                    track.keyframe.pending = None;
                }
                ctx.tick(p, now);
            }
            // Nothing has arrived on the track yet, so its first frame will
            // be a keyframe anyway.
            Ok(false) => {
                if let Some(track) = p.published_mut(mid) {
                    track.keyframe.pending = None;
                }
                ctx.drain(p, now);
            }
            Err(()) => ctx.work.push_back(Work::Close {
                key: publisher,
                reason: CloseReason::Error,
            }),
        }
    }

    /// Forwards one packet of a publisher to every other session of its room
    /// that receives the track. Nothing is decoded: the payload is passed on
    /// as it came, and only what belongs to each receiving connection is
    /// rewritten.
    fn forward(&mut self, now: Instant, from: SessionKey, packet: &RtpPacket) {
        let Some(publisher) = self.sessions.get_mut(&from) else {
            return;
        };
        publisher.ingress.count(packet.payload.len());

        let (mid, looked_up) = mid_for_ssrc(publisher, packet);
        if looked_up {
            // Looking a stream up goes through str0m's mutable API, which
            // counts as a mutation and is followed by a drain like any other.
            let (mut ctx, sessions) = self.ctx();
            if let Some(publisher) = sessions.get_mut(&from) {
                ctx.drain(publisher, now);
            }
        }
        let Some(mid) = mid else {
            return;
        };
        let Some(publisher) = self.sessions.get_mut(&from) else {
            return;
        };
        let Some(track) = publisher.published.iter().find(|t| t.mid == mid) else {
            return;
        };
        let kind = track.kind;
        let Some(params) = publisher
            .rtc
            .codec_config()
            .iter()
            .find(|p| p.pt() == packet.header.payload_type)
            .copied()
        else {
            return;
        };
        let generation_in = publisher.generation;
        let room = publisher.room;
        let source = TrackKey { session: from, mid };

        let mut starts = false;
        let Core {
            sessions,
            rooms,
            outgoing,
            work,
            timers,
            ..
        } = self;
        let mut ctx = Ctx {
            outgoing,
            work,
            timers,
        };
        let Some(room) = rooms.get(&room) else {
            return;
        };
        for target in &room.sessions {
            if *target == from {
                continue;
            }
            let Some(s) = sessions.get_mut(target) else {
                continue;
            };
            starts |= forward_to(
                &mut ctx,
                s,
                source,
                kind,
                params,
                generation_in,
                packet,
                now,
            );
        }

        if starts {
            self.request_keyframe(now, from, mid, KeyframeRequestKind::Pli);
        }
    }

    // ---------------------------------------------------------------- closing

    /// Ends a session. `reason` is `None` for closures through the control
    /// API, which never produce an event.
    fn close(
        &mut self,
        now: Instant,
        key: SessionKey,
        reason: Option<CloseReason>,
        renegotiate: bool,
    ) {
        let Some(mut s) = self.sessions.remove(&key) else {
            return;
        };

        self.by_id.remove(&s.id);
        if self.by_user.get(&s.user_id) == Some(&key) {
            self.by_user.remove(&s.user_id);
        }
        self.by_ufrag.remove(&s.ufrag);
        for addr in &s.addrs {
            if self.by_addr.get(addr) == Some(&key) {
                self.by_addr.remove(addr);
            }
        }

        let mut others = Vec::new();
        if let Some(room) = self.rooms.get_mut(&s.room) {
            room.sessions.retain(|k| *k != key);
            others = room.sessions.clone();
            if room.sessions.is_empty() {
                let id = room.id.clone();
                self.rooms.remove(&s.room);
                self.room_by_id.remove(&id);
            }
        }

        match reason {
            Some(reason) => {
                info!(session = %s.id, ?reason, "session closed by the media plane");
                self.log.push(EventBody::Closed {
                    session_id: s.id.clone(),
                    reason,
                });
            }
            None => info!(session = %s.id, "session closed"),
        }

        // A last, best effort goodbye to the browser.
        let outgoing = &mut self.outgoing;
        let _ = guard(|| {
            if s.rtc.close().is_err() {
                return;
            }
            for _ in 0..64 {
                match s.rtc.poll_output() {
                    Ok(Output::Transmit(t)) => outgoing.push(Outgoing {
                        destination: t.destination,
                        contents: t.contents,
                    }),
                    Ok(Output::Event(_)) => {}
                    Ok(Output::Timeout(_)) | Err(_) => break,
                }
            }
        });

        // Whoever received this session's tracks stops at once and is told.
        let mut changed = Vec::new();
        for other in &others {
            if let Some(o) = self.sessions.get_mut(other) {
                let mut any = false;
                for track in &s.published {
                    any |= o.withdraw_out(TrackKey {
                        session: key,
                        mid: track.mid,
                    });
                }
                if any {
                    changed.push(*other);
                }
            }
        }
        if renegotiate {
            for other in changed {
                self.maybe_offer(now, other);
            }
        }
    }
}

/// The mid of the section an incoming packet belongs to, and whether str0m
/// had to be asked. str0m maps SSRCs to mids itself; the answer is cached
/// because a packet does not always carry the mid header extension.
fn mid_for_ssrc(s: &mut Session, packet: &RtpPacket) -> (Option<Mid>, bool) {
    let ssrc = packet.header.ssrc;
    if let Some((_, mid)) = s.ssrc_mids.iter().find(|(x, _)| *x == ssrc) {
        return (Some(*mid), false);
    }
    let Some(mid) = guard(|| {
        s.rtc
            .direct_api()
            .stream_rx(&ssrc)
            .map(|stream| stream.mid())
    })
    .ok()
    .flatten() else {
        return (None, true);
    };
    if s.ssrc_mids.len() >= 32 {
        s.ssrc_mids.remove(0);
    }
    s.ssrc_mids.push((ssrc, mid));
    (Some(mid), true)
}

/// Writes one forwarded packet to one receiving session. Returns whether it
/// was the first packet of a video section, which then needs a keyframe.
#[allow(clippy::too_many_arguments)]
fn forward_to(
    ctx: &mut Ctx,
    s: &mut Session,
    source: TrackKey,
    kind: MediaKind,
    params: PayloadParams,
    generation_in: u64,
    packet: &RtpPacket,
    now: Instant,
) -> bool {
    let Some(&idx) = s.out_by_source.get(&source) else {
        return false;
    };
    let OutState::Live(mid) = s.outs[idx].state else {
        return false;
    };
    if !s.rtc.is_connected() {
        return false;
    }
    let Some(media) = s.rtc.media(mid) else {
        return false;
    };
    if !media.direction().is_sending() {
        return false;
    }

    let out = &mut s.outs[idx];
    let pt = match out.pt_cache {
        Some(c)
            if c.pt_in == params.pt()
                && c.generation_in == generation_in
                && c.generation_out == s.generation =>
        {
            c.pt_out
        }
        _ => {
            // The payload type is chosen by matching codec parameters, never
            // by copying the number: two browsers may number one codec
            // differently.
            let pt_out = s
                .rtc
                .codec_config()
                .match_params(params)
                .map(|p| p.pt())
                .filter(|pt| media.remote_pts().contains(pt));
            out.pt_cache = Some(PtCache {
                pt_in: params.pt(),
                generation_in,
                generation_out: s.generation,
                pt_out,
            });
            pt_out
        }
    };
    // The receiving browser did not negotiate this codec.
    let Some(pt) = pt else {
        return false;
    };

    let Some((seq, ts)) =
        out.rewrite
            .map(packet.header.ssrc, *packet.seq_no, packet.header.timestamp)
    else {
        return false;
    };
    let starts = !out.started;
    out.started = true;

    // Only extensions that describe the media travel on. Ids, mids, rids,
    // send times and transport sequence numbers belong to each connection
    // and str0m writes its own.
    let incoming = &packet.header.ext_vals;
    let ext_vals = ExtensionValues {
        audio_level: incoming.audio_level,
        voice_activity: incoming.voice_activity,
        video_orientation: incoming.video_orientation,
        ..Default::default()
    };
    let write = RtpWrite::new(pt, seq.into(), ts, packet.timestamp, packet.payload.clone())
        .marker(packet.header.marker)
        .ext_vals(ext_vals)
        .nackable(kind == MediaKind::Video);

    let written = guard(|| match s.rtc.direct_api().stream_tx_by_mid(mid, None) {
        Some(stream) => {
            stream.write_rtp(write);
            true
        }
        None => false,
    });
    match written {
        Ok(true) => {}
        Ok(false) => return false,
        Err(()) => {
            ctx.work.push_back(Work::Close {
                key: s.key,
                reason: CloseReason::Error,
            });
            return false;
        }
    }
    s.egress.count(packet.payload.len());

    // A written packet waits in str0m's send queue until time moves, so the
    // write is drained and then followed by the current time.
    ctx.drain(s, now);
    ctx.tick(s, now);

    starts && kind == MediaKind::Video
}

#[cfg(test)]
mod tests {
    use super::*;

    const ROOM: &str = "00000000-0000-4000-8000-00000000aaaa";
    const USER: &str = "00000000-0000-4000-8000-000000000001";

    fn host(n: usize) -> String {
        format!(
            "candidate:{n} 1 udp 2130706431 10.1.{}.{} 5000 typ host",
            n / 256,
            n % 256
        )
    }

    #[test]
    fn a_browser_hands_its_session_a_bounded_number_of_candidates() {
        let now = Instant::now();
        let mut core = Core::new(
            CoreConfig {
                candidates: vec!["203.0.113.7:49000".parse().unwrap()],
            },
            "e".into(),
        );
        let id = core.create_session(now, ROOM, USER).unwrap().session_id;

        let sent = MAX_REMOTE_CANDIDATES + 20;
        for n in 0..sent {
            let value = json!({ "candidate": host(n), "sdpMid": "0", "sdpMLineIndex": 0 });
            assert_eq!(core.candidate(now, &id, Some(&value)), Ok(()));
        }
        // Past the limit malformed input is still refused.
        let garbage = json!({ "candidate": "candidate:garbage" });
        assert!(matches!(
            core.candidate(now, &id, Some(&garbage)),
            Err(ApiError::InvalidCandidate(_))
        ));

        // str0m can invalidate exactly the candidates it was given.
        let key = core.by_id[&id];
        let rtc = &mut core.sessions.get_mut(&key).unwrap().rtc;
        let mut known = |n: usize| {
            let candidate = Candidate::from_sdp_string(&host(n)).unwrap();
            rtc.direct_api().invalidate_candidate(&candidate)
        };
        assert!(known(0));
        assert!(known(MAX_REMOTE_CANDIDATES - 1));
        assert!(!known(MAX_REMOTE_CANDIDATES));
        assert!(!known(sent - 1));
    }
}
