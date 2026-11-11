//! An in-memory network of browser-like str0m clients and one core.
//!
//! The clients run full ICE, as browsers do, against the ICE-lite core. The
//! harness plays the part of the API: it relays each client's offers, answers
//! and candidates to the core, and the core's events back to the client they
//! name, in log order. A client is impolite in the way the contract asks of
//! a browser: it ignores a media server offer while its own is unanswered.
//!
//! The network behaves like a NAT in front of the server's one socket. The
//! core never learns which advertised address a datagram was sent to, and a
//! reply reaches the client from the address the client sent to, whatever
//! str0m believes its source to be.

#![allow(dead_code)]

use std::collections::HashMap;
use std::net::SocketAddr;
use std::time::{Duration, Instant};

use serde_json::Value;
use stellarr_media::core::{ApiError, Core, CoreConfig};
use str0m::change::{SdpAnswer, SdpApi, SdpOffer, SdpPendingOffer};
use str0m::format::Codec;
use str0m::media::{MediaKind, Mid, Pt};
use str0m::net::{Protocol, Receive};
use str0m::rtp::{RtpPacket, RtpWrite};
use str0m::{Candidate, Event, Input, Output, Rtc, RtcConfig};

pub const PUBLIC: &str = "203.0.113.7:49000";
pub const CONTAINER: &str = "172.18.0.2:49000";
pub const ROOM: &str = "00000000-0000-4000-8000-00000000aaaa";

pub fn uuid(n: u64) -> String {
    format!("00000000-0000-4000-8000-{n:012x}")
}

pub fn addr(s: &str) -> SocketAddr {
    s.parse().unwrap()
}

/// A packet a client received, with the mid of the section it came on.
pub struct Received {
    pub mid: Mid,
    pub packet: RtpPacket,
}

pub struct Client {
    pub user_id: String,
    pub session_id: String,
    pub rtc: Rtc,
    pub addr: SocketAddr,
    /// The address a NAT in front of the client gives it, when it has one.
    /// The media server sees only this one.
    pub public: Option<SocketAddr>,
    /// The server address this client last sent to, as a NAT remembers it.
    pub target: Option<SocketAddr>,
    pub pending: Option<SdpPendingOffer>,
    pub timeout: Instant,
    pub events: Vec<Event>,
    pub received: Vec<Received>,
    /// The latest directory the client was given.
    pub directory: Vec<Value>,
    pub offers_seen: Vec<u64>,
    pub answer_results: Vec<Result<(), ApiError>>,
    pub ignore_offers: bool,
    /// Keeps only this server candidate from every description, as a browser
    /// that can only reach the media server through a relay would.
    pub only_candidate: Option<SocketAddr>,
    pub blocked: bool,
    pub closed: Option<String>,
    /// Why the client's own connection failed, if it did.
    pub failure: Option<String>,
    pub next_seq: HashMap<Mid, u64>,
    pub sent: usize,
    /// One RTP packet, by payload type and sequence number, that the network
    /// loses on its way from this client to the media server.
    pub lose_outgoing: Option<(u8, u16)>,
    /// One RTP packet the network loses on its way to this client.
    pub lose_incoming: Option<(u8, u16)>,
}

/// Whether a datagram is the RTP packet `rule` names. The fixed RTP header
/// is not encrypted by SRTP, so it can be read on the wire.
fn is_lost(rule: &mut Option<(u8, u16)>, data: &[u8]) -> bool {
    let Some((pt, seq)) = *rule else {
        return false;
    };
    let matches = data.len() >= 12
        && data[0] >> 6 == 2
        && data[1] & 0x7f == pt
        && u16::from_be_bytes([data[2], data[3]]) == seq;
    if matches {
        *rule = None;
    }
    matches
}

impl Client {
    /// The address the media server sees this client at.
    pub fn seen_at(&self) -> SocketAddr {
        self.public.unwrap_or(self.addr)
    }

    pub fn is_connected(&self) -> bool {
        self.rtc.is_connected()
    }

    pub fn pt_of(&self, codec: Codec) -> Pt {
        self.rtc
            .codec_config()
            .iter()
            .find(|p| p.spec().codec == codec)
            .map(|p| p.pt())
            .expect("the client has the codec")
    }

    pub fn received_on(&self, mid: &str) -> Vec<&RtpPacket> {
        self.received
            .iter()
            .filter(|r| &*r.mid == mid)
            .map(|r| &r.packet)
            .collect()
    }

    pub fn directory_entry(&self, mid: &str) -> Option<&Value> {
        self.directory.iter().find(|t| t["mid"] == mid)
    }

    pub fn directory_mids(&self) -> Vec<String> {
        self.directory
            .iter()
            .map(|t| t["mid"].as_str().unwrap().to_string())
            .collect()
    }

    pub fn has_event(&self, f: impl Fn(&Event) -> bool) -> bool {
        self.events.iter().any(f)
    }

    fn drain(&mut self, out: &mut Vec<(SocketAddr, Vec<u8>)>) {
        loop {
            // A client cut off from the network gives up on its own, as a
            // browser would; that is recorded, not a failure of the test.
            let output = match self.rtc.poll_output() {
                Ok(output) => output,
                Err(e) => {
                    self.failure = Some(e.to_string());
                    return;
                }
            };
            match output {
                Output::Timeout(t) => {
                    self.timeout = t;
                    return;
                }
                Output::Transmit(t) => out.push((t.destination, t.contents.to_vec())),
                Output::Event(Event::RtpPacket(packet)) => {
                    let mid = self
                        .rtc
                        .direct_api()
                        .stream_rx(&packet.header.ssrc)
                        .map(|s| s.mid())
                        .expect("a packet on a known stream");
                    self.received.push(Received { mid, packet });
                }
                Output::Event(e) => self.events.push(e),
            }
        }
    }
}

pub struct Net {
    pub core: Core,
    pub now: Instant,
    pub clients: Vec<Client>,
    pub candidates: Vec<SocketAddr>,
    pub seen: u64,
    /// Every event the core produced, in order, as the API would relay it.
    pub log: Vec<Value>,
    pub outbox: Vec<Vec<(SocketAddr, Vec<u8>)>>,
    /// Drops every datagram, so nothing ever connects. Negotiation still
    /// works: it only needs the signalling path.
    pub offline: bool,
}

impl Net {
    pub fn new() -> Net {
        Net::with_candidates(&[PUBLIC, CONTAINER])
    }

    pub fn with_candidates(candidates: &[&str]) -> Net {
        let candidates: Vec<SocketAddr> = candidates.iter().map(|c| addr(c)).collect();
        Net {
            core: Core::new(
                CoreConfig {
                    candidates: candidates.clone(),
                },
                "epoch-1".into(),
            ),
            now: Instant::now(),
            clients: Vec::new(),
            candidates,
            seen: 0,
            log: Vec::new(),
            outbox: Vec::new(),
            offline: false,
        }
    }

    pub fn offline() -> Net {
        let mut net = Net::new();
        net.offline = true;
        net
    }

    /// Creates a session and its client. The client offers nothing yet.
    pub fn join(&mut self, user: u64) -> usize {
        self.join_with(ROOM, user, |c| c)
    }

    pub fn join_with(
        &mut self,
        room: &str,
        user: u64,
        configure: impl FnOnce(RtcConfig) -> RtcConfig,
    ) -> usize {
        let user_id = uuid(user);
        let created = self
            .core
            .create_session(self.now, room, &user_id)
            .expect("a session");
        let index = self.clients.len();
        let mut rtc = configure(Rtc::builder().set_rtp_mode(true)).build(self.now);
        let client_addr = addr(&format!("10.0.0.{}:5000", index + 1));
        rtc.add_local_candidate(Candidate::host(client_addr, "udp").unwrap());

        self.clients.push(Client {
            user_id,
            session_id: created.session_id,
            rtc,
            addr: client_addr,
            public: None,
            target: None,
            pending: None,
            timeout: self.now,
            events: Vec::new(),
            received: Vec::new(),
            directory: Vec::new(),
            offers_seen: Vec::new(),
            answer_results: Vec::new(),
            ignore_offers: false,
            only_candidate: None,
            blocked: false,
            closed: None,
            failure: None,
            next_seq: HashMap::new(),
            sent: 0,
            lose_outgoing: None,
            lose_incoming: None,
        });
        self.outbox.push(Vec::new());
        self.drain_client(index);
        index
    }

    /// Makes the client offer whatever `change` does. The offer text can be
    /// edited on the way, as a browser that sets new stream ids would.
    pub fn offer_with<R>(
        &mut self,
        i: usize,
        change: impl FnOnce(&mut SdpApi) -> R,
        edit: impl FnOnce(String) -> String,
    ) -> (R, Result<(), ApiError>) {
        let c = &mut self.clients[i];
        let mut api = c.rtc.sdp_api();
        let r = change(&mut api);
        let (offer, pending) = api.apply().expect("the change needs an offer");
        c.pending = Some(pending);
        self.drain_client(i);

        let sdp = edit(offer.to_sdp_string());
        let session = self.clients[i].session_id.clone();
        let result = self.core.offer(self.now, &session, &sdp);
        if result.is_err() {
            self.clients[i].pending = None;
        }
        self.flush();
        self.pump();
        (r, result)
    }

    pub fn offer<R>(
        &mut self,
        i: usize,
        change: impl FnOnce(&mut SdpApi) -> R,
    ) -> (R, Result<(), ApiError>) {
        self.offer_with(i, change, |s| s)
    }

    /// Publishes one send-only track with a stream id and returns its mid.
    pub fn publish(&mut self, i: usize, kind: MediaKind, stream: &str) -> Mid {
        let (mid, result) = self.offer(i, |api| {
            api.add_media(
                kind,
                str0m::media::Direction::SendOnly,
                Some(stream.into()),
                None,
                None,
            )
        });
        result.expect("the offer is accepted");
        mid
    }

    /// Reads every new event and delivers it to its client, until the core
    /// has nothing more to say.
    pub fn pump(&mut self) {
        loop {
            let poll = self.core.events(Some("epoch-1"), self.seen);
            assert!(!poll.reset, "the harness never falls behind");
            if poll.events.is_empty() {
                return;
            }
            for event in poll.events {
                self.seen = event.seq;
                let value = serde_json::to_value(&*event).unwrap();
                self.log.push(value.clone());
                self.deliver(value);
            }
        }
    }

    fn deliver(&mut self, event: Value) {
        let session = event["sessionId"].as_str().unwrap();
        let Some(i) = self.clients.iter().position(|c| c.session_id == session) else {
            return;
        };

        if event["type"] == "closed" {
            self.clients[i].closed = Some(event["reason"].as_str().unwrap().to_string());
            return;
        }

        let payload = &event["payload"];
        match event["kind"].as_str().unwrap() {
            "answer" => {
                let c = &mut self.clients[i];
                let pending = c.pending.take().expect("an answer to a pending offer");
                let sdp = self.filter_candidates(i, payload["sdp"].as_str().unwrap());
                let answer = SdpAnswer::from_sdp_string(&sdp).unwrap();
                self.clients[i]
                    .rtc
                    .sdp_api()
                    .accept_answer(pending, answer)
                    .expect("the answer applies");
                self.drain_client(i);
            }
            "offer" => {
                let id = payload["negotiationId"].as_u64().unwrap();
                let c = &mut self.clients[i];
                c.offers_seen.push(id);
                c.directory = payload["tracks"].as_array().unwrap().clone();
                // Impolite: a server offer that collides with our own is ignored.
                if c.ignore_offers || c.pending.is_some() {
                    return;
                }
                let sdp = self.filter_candidates(i, payload["sdp"].as_str().unwrap());
                let offer = SdpOffer::from_sdp_string(&sdp).unwrap();
                let answer = self.clients[i]
                    .rtc
                    .sdp_api()
                    .accept_offer(offer)
                    .expect("the offer applies");
                self.drain_client(i);
                let session = self.clients[i].session_id.clone();
                let result = self
                    .core
                    .answer(self.now, &session, &answer.to_sdp_string(), id);
                self.clients[i].answer_results.push(result);
            }
            "tracks" => {
                self.clients[i].directory = payload["tracks"].as_array().unwrap().clone();
            }
            other => panic!("unknown signal {other}"),
        }
    }

    fn filter_candidates(&self, i: usize, sdp: &str) -> String {
        let Some(only) = self.clients[i].only_candidate else {
            return sdp.to_string();
        };
        sdp.split("\r\n")
            .filter(|line| {
                let Some(rest) = line.strip_prefix("a=candidate:") else {
                    return true;
                };
                let t: Vec<&str> = rest.split_whitespace().collect();
                format!("{}:{}", t[4], t[5]) == only.to_string()
            })
            .collect::<Vec<_>>()
            .join("\r\n")
    }

    fn drain_client(&mut self, i: usize) {
        let mut out = Vec::new();
        self.clients[i].drain(&mut out);
        self.outbox[i].extend(out);
    }

    /// Moves datagrams until nobody has anything more to send.
    pub fn flush(&mut self) {
        loop {
            let mut moved = false;

            for i in 0..self.clients.len() {
                self.drain_client(i);
                for (destination, data) in std::mem::take(&mut self.outbox[i]) {
                    moved = true;
                    if self.clients[i].blocked
                        || self.offline
                        || is_lost(&mut self.clients[i].lose_outgoing, &data)
                    {
                        continue;
                    }
                    self.clients[i].target = Some(destination);
                    let source = self.clients[i].seen_at();
                    self.core.handle_datagram(self.now, source, &data);
                }
            }

            for out in self.core.take_outgoing() {
                moved = true;
                let Some(i) = self
                    .clients
                    .iter()
                    .position(|c| c.seen_at() == out.destination)
                else {
                    continue;
                };
                if self.clients[i].blocked
                    || self.offline
                    || is_lost(&mut self.clients[i].lose_incoming, &out.contents)
                {
                    continue;
                }
                let source = self.clients[i].target.unwrap_or(self.candidates[0]);
                let c = &mut self.clients[i];
                let receive = Receive::new(Protocol::Udp, source, c.addr, &out.contents).unwrap();
                c.rtc
                    .handle_input(Input::Receive(self.now, receive))
                    .expect("the client takes the datagram");
                self.drain_client(i);
            }

            if !moved {
                return;
            }
        }
    }

    pub fn step(&mut self, dt: Duration) {
        self.now += dt;
        let now = self.now;
        if self.core.poll_timeout().is_some_and(|t| t <= now) {
            self.core.handle_timeout(now);
        }
        for i in 0..self.clients.len() {
            if self.clients[i].timeout <= now {
                if let Err(e) = self.clients[i].rtc.handle_input(Input::Timeout(now)) {
                    self.clients[i].failure = Some(e.to_string());
                }
                self.drain_client(i);
            }
        }
        self.flush();
        self.pump();
    }

    pub fn run_for(&mut self, d: Duration) {
        let end = self.now + d;
        while self.now < end {
            self.step(Duration::from_millis(5));
        }
    }

    /// Runs until `done` holds, failing the test after `limit`.
    pub fn run_until(&mut self, limit: Duration, done: impl Fn(&Net) -> bool) {
        let end = self.now + limit;
        while !done(self) {
            assert!(
                self.now < end,
                "the condition did not hold within {limit:?}"
            );
            self.step(Duration::from_millis(5));
        }
    }

    pub fn connect_all(&mut self) {
        self.run_until(Duration::from_secs(5), |n| {
            n.clients.iter().all(|c| c.is_connected())
        });
    }

    /// Sends one RTP packet on a published section with a payload type of
    /// the client's own numbering.
    pub fn send(&mut self, i: usize, mid: Mid, pt: Pt, payload: &[u8]) {
        let now = self.now;
        let c = &mut self.clients[i];
        let seq = c.next_seq.entry(mid).or_insert(1);
        let this = *seq;
        *seq += 1;
        let write = RtpWrite::new(pt, this.into(), (this as u32) * 960, now, payload.to_vec())
            .marker(true)
            .nackable(true);
        c.rtc
            .direct_api()
            .stream_tx_by_mid(mid, None)
            .expect("a sending stream")
            .write_rtp(write);
        c.sent += 1;
        self.drain_client(i);
        self.clients[i]
            .rtc
            .handle_input(Input::Timeout(now))
            .unwrap();
        self.drain_client(i);
        self.flush();
    }

    pub fn send_audio(&mut self, i: usize, mid: Mid, payload: &[u8]) {
        let pt = self.clients[i].pt_of(Codec::Opus);
        self.send(i, mid, pt, payload);
    }

    pub fn client(&self, i: usize) -> &Client {
        &self.clients[i]
    }

    pub fn events_of(&self, i: usize) -> Vec<&Value> {
        let session = &self.clients[i].session_id;
        self.log
            .iter()
            .filter(|e| e["sessionId"] == *session)
            .collect()
    }

    pub fn signals_of(&self, i: usize, kind: &str) -> Vec<&Value> {
        self.events_of(i)
            .into_iter()
            .filter(|e| e["type"] == "signal" && e["kind"] == kind)
            .collect()
    }
}

pub fn is_audio(t: &Value) -> bool {
    t["kind"] == "audio"
}

pub fn media_kind_of(mid: Mid, rtc: &Rtc) -> Option<MediaKind> {
    rtc.media(mid).map(|m| m.kind())
}
