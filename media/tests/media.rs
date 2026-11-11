//! The media server with real protocol stacks in one process: str0m clients
//! with full ICE, DTLS and SRTP, connected to the core through an in-memory
//! network.

mod common;

use std::net::SocketAddr;
use std::time::Duration;

use common::*;
use serde_json::Value;
use stellarr_media::core::MAX_SOURCE_ADDRS;
use str0m::bwe::Bitrate;
use str0m::format::{Codec, FormatParams};
use str0m::media::{Direction, Frequency, KeyframeRequestKind, MediaKind, Mid};
use str0m::rtp::{ExtensionValues, RtpWrite};
use str0m::{Event, Input, Output};

/// The mid of the section that carries `user`'s track of `kind` for client `i`.
fn mid_from(net: &Net, i: usize, user: u64, kind: &str) -> String {
    net.client(i)
        .directory
        .iter()
        .find(|t| t["userId"] == uuid(user) && t["kind"] == kind)
        .and_then(|t| t["mid"].as_str())
        .unwrap_or_else(|| {
            panic!(
                "client {i} has no {kind} of user {user}: {:?}",
                net.client(i).directory
            )
        })
        .to_string()
}

fn payloads(net: &Net, i: usize, mid: &str) -> Vec<Vec<u8>> {
    net.client(i)
        .received_on(mid)
        .iter()
        .map(|p| p.payload.to_vec())
        .collect()
}

fn last_offer_sdp(net: &Net, i: usize) -> String {
    net.signals_of(i, "offer").last().unwrap()["payload"]["sdp"]
        .as_str()
        .unwrap()
        .to_string()
}

fn section_direction(sdp: &str, mid: &str) -> stellarr_media::sdp_text::Direction {
    stellarr_media::sdp_text::sections(sdp)
        .into_iter()
        .find(|s| s.mid == mid)
        .unwrap_or_else(|| panic!("no section {mid}"))
        .direction
}

fn send_video(net: &mut Net, i: usize, mid: Mid, payload: &[u8]) {
    let pt = net.client(i).pt_of(Codec::Vp8);
    net.send(i, mid, pt, payload);
}

#[test]
fn two_clients_hear_each_other_with_the_payload_intact() {
    let mut net = Net::new();
    let a = net.join(1);
    let b = net.join(2);
    let mic_a = net.publish(a, MediaKind::Audio, "mic-a");
    let mic_b = net.publish(b, MediaKind::Audio, "mic-b");
    net.connect_all();

    let a_on_b = mid_from(&net, b, 1, "audio");
    let b_on_a = mid_from(&net, a, 2, "audio");

    for n in 0..20u8 {
        net.send_audio(a, mic_a, &[n, 0xaa, n, 0x55]);
        net.send_audio(b, mic_b, &[n, 0xbb]);
        net.step(Duration::from_millis(20));
    }

    let expected_a: Vec<Vec<u8>> = (0..20u8).map(|n| vec![n, 0xaa, n, 0x55]).collect();
    let expected_b: Vec<Vec<u8>> = (0..20u8).map(|n| vec![n, 0xbb]).collect();
    assert_eq!(payloads(&net, b, &a_on_b), expected_a);
    assert_eq!(payloads(&net, a, &b_on_a), expected_b);

    // Nobody receives their own microphone, and nothing else arrives.
    assert_eq!(net.client(a).received.len(), 20);
    assert_eq!(net.client(b).received.len(), 20);
    assert_eq!(net.client(a).directory.len(), 1);
    assert_eq!(net.client(b).directory.len(), 1);

    // Each receiver gets the payload type of its own Opus.
    let pt = net.client(b).pt_of(Codec::Opus);
    assert!(
        net.client(b)
            .received
            .iter()
            .all(|r| r.packet.header.payload_type == pt)
    );

    // Sequence numbers run on without gaps on the receiving connection.
    let seqs: Vec<u64> = net
        .client(b)
        .received
        .iter()
        .map(|r| *r.packet.seq_no)
        .collect();
    assert!(seqs.windows(2).all(|w| w[1] == w[0] + 1), "{seqs:?}");

    let stats = net.core.stats(net.now);
    let sessions = &stats.rooms[0].sessions;
    assert!(sessions.iter().all(|s| s.state == "connected"));
    assert!(
        sessions
            .iter()
            .all(|s| s.ingress.packets == 20 && s.egress.packets == 20)
    );
    assert!(
        sessions
            .iter()
            .all(|s| s.published == 1 && s.forwarded == 1)
    );
}

#[test]
fn three_clients_get_sound_and_picture_of_the_others() {
    let mut net = Net::new();
    let a = net.join(1);
    let b = net.join(2);
    let c = net.join(3);

    let mic_a = net.publish(a, MediaKind::Audio, "stream-a");
    let cam_a = net.publish(a, MediaKind::Video, "stream-a");
    let mic_b = net.publish(b, MediaKind::Audio, "stream-b");
    let mic_c = net.publish(c, MediaKind::Audio, "stream-c");
    net.connect_all();
    net.run_for(Duration::from_millis(100));

    for (i, others) in [(a, [2, 3]), (b, [1, 3]), (c, [1, 2])] {
        let users: Vec<&Value> = net
            .client(i)
            .directory
            .iter()
            .map(|t| &t["userId"])
            .collect();
        for other in others {
            assert!(
                users.contains(&&Value::from(uuid(other))),
                "client {i} misses {other}"
            );
        }
        assert!(
            !users.contains(&&Value::from(net.client(i).user_id.clone())),
            "client {i} gets itself"
        );
    }
    assert_eq!(net.client(b).directory.len(), 3);
    assert_eq!(net.client(a).directory.len(), 2);

    for n in 0..10u8 {
        net.send_audio(a, mic_a, &[1, n]);
        net.send_audio(b, mic_b, &[2, n]);
        net.send_audio(c, mic_c, &[3, n]);
        send_video(&mut net, a, cam_a, &[0x90, 0x80, n, 7, 7, 7]);
        net.step(Duration::from_millis(20));
    }

    for receiver in [b, c] {
        let picture = payloads(&net, receiver, &mid_from(&net, receiver, 1, "video"));
        let expected: Vec<Vec<u8>> = (0..10u8).map(|n| vec![0x90, 0x80, n, 7, 7, 7]).collect();
        assert_eq!(picture, expected, "picture at {receiver}");
        let sound = payloads(&net, receiver, &mid_from(&net, receiver, 1, "audio"));
        assert_eq!(sound.len(), 10);
    }
    assert_eq!(payloads(&net, a, &mid_from(&net, a, 2, "audio")).len(), 10);
    assert_eq!(payloads(&net, a, &mid_from(&net, a, 3, "audio")).len(), 10);
    assert_eq!(
        net.client(a).received.len(),
        20,
        "A receives B and C, never itself"
    );

    // The picture and the sound of one person share the msid stream.
    let sdp = last_offer_sdp(&net, b);
    let sections = stellarr_media::sdp_text::sections(&sdp);
    let stream_of = |mid: &str| {
        sections
            .iter()
            .find(|s| s.mid == mid)
            .unwrap()
            .stream_id
            .clone()
    };
    assert_eq!(
        stream_of(&mid_from(&net, b, 1, "video")),
        Some("stream-a".into())
    );
    assert_eq!(
        stream_of(&mid_from(&net, b, 1, "audio")),
        Some("stream-a".into())
    );
}

#[test]
fn the_payload_type_follows_the_codec_and_unknown_codecs_are_dropped() {
    let mut net = Net::new();
    // The publisher numbers VP8 as 120, as Firefox does. One receiver takes
    // the media server's numbering, 96, and the other does not take VP8 at
    // all.
    let a = net.join_with(ROOM, 1, |mut c| {
        c = c.clear_codecs().enable_opus(true, false);
        c.codec_config().add_config(
            120.into(),
            Some(121.into()),
            Codec::Vp8,
            Frequency::NINETY_KHZ,
            None,
            FormatParams::default(),
        );
        c
    });
    let b = net.join(2);
    let c = net.join_with(ROOM, 3, |c| {
        c.clear_codecs().enable_opus(true, false).enable_vp9(true)
    });

    let cam_a = net.publish(a, MediaKind::Video, "camera-a");
    net.publish(b, MediaKind::Audio, "mic-b");
    net.publish(c, MediaKind::Audio, "mic-c");
    net.connect_all();
    net.run_for(Duration::from_millis(100));

    let sent_pt = net.client(a).pt_of(Codec::Vp8);
    assert_eq!(*sent_pt, 120);
    for n in 0..5u8 {
        net.send(a, cam_a, sent_pt, &[n, 1, 2]);
        net.step(Duration::from_millis(30));
    }

    let at_b = net.client(b).received_on(&mid_from(&net, b, 1, "video"));
    assert_eq!(at_b.len(), 5);
    let b_vp8 = net.client(b).pt_of(Codec::Vp8);
    assert_ne!(sent_pt, b_vp8, "the two connections number VP8 differently");
    assert!(at_b.iter().all(|p| p.header.payload_type == b_vp8));

    // C negotiated no VP8, so the section stays silent.
    let at_c = net.client(c).received_on(&mid_from(&net, c, 1, "video"));
    assert!(at_c.is_empty());
}

#[test]
fn the_audio_level_travels_with_the_sound() {
    let mut net = Net::new();
    let a = net.join(1);
    let b = net.join(2);
    let mic_a = net.publish(a, MediaKind::Audio, "mic-a");
    net.publish(b, MediaKind::Audio, "mic-b");
    net.connect_all();

    let pt = net.client(a).pt_of(Codec::Opus);
    let now = net.now;
    let ext = ExtensionValues {
        audio_level: Some(-33),
        voice_activity: Some(true),
        ..Default::default()
    };
    net.clients[a]
        .rtc
        .direct_api()
        .stream_tx_by_mid(mic_a, None)
        .unwrap()
        .write_rtp(RtpWrite::new(pt, 1.into(), 960, now, vec![5, 5]).ext_vals(ext));
    net.clients[a]
        .rtc
        .handle_input(Input::Timeout(now))
        .unwrap();
    net.flush();
    net.run_for(Duration::from_millis(20));

    let got = net.client(b).received_on(&mid_from(&net, b, 1, "audio"));
    assert_eq!(got.len(), 1);
    assert_eq!(got[0].header.ext_vals.audio_level, Some(-33));
    assert_eq!(got[0].header.ext_vals.voice_activity, Some(true));
}

#[test]
fn a_late_join_gets_the_existing_tracks_and_a_directory_that_names_them() {
    let mut net = Net::new();
    let a = net.join(1);
    let b = net.join(2);
    let mic_a = net.publish(a, MediaKind::Audio, "mic-a");
    let cam_a = net.publish(a, MediaKind::Video, "cam-a");
    let mic_b = net.publish(b, MediaKind::Audio, "mic-b");
    net.connect_all();
    net.run_for(Duration::from_secs(2));

    let c = net.join(3);
    net.publish(c, MediaKind::Audio, "mic-c");
    net.connect_all();
    net.run_for(Duration::from_millis(100));

    let directory = &net.client(c).directory;
    assert_eq!(directory.len(), 3);
    let streams: Vec<(&Value, &Value)> = directory
        .iter()
        .map(|t| (&t["userId"], &t["streamId"]))
        .collect();
    for (user, stream) in [(1, "mic-a"), (1, "cam-a"), (2, "mic-b")] {
        assert!(
            streams.contains(&(&Value::from(uuid(user)), &Value::from(stream))),
            "{streams:?}"
        );
    }

    for n in 0..5u8 {
        net.send_audio(a, mic_a, &[n]);
        net.send_audio(b, mic_b, &[n, n]);
        send_video(&mut net, a, cam_a, &[n, n, n]);
        net.step(Duration::from_millis(20));
    }
    assert_eq!(payloads(&net, c, &mid_from(&net, c, 1, "audio")).len(), 5);
    assert_eq!(payloads(&net, c, &mid_from(&net, c, 2, "audio")).len(), 5);
    assert_eq!(payloads(&net, c, &mid_from(&net, c, 1, "video")).len(), 5);
    // And the others got C's microphone.
    assert_eq!(net.client(a).directory.len(), 2);
    assert_eq!(net.client(b).directory.len(), 3);
    assert!(!mid_from(&net, b, 3, "audio").is_empty());
}

#[test]
fn a_leave_makes_the_sections_inactive_and_updates_the_directory() {
    let mut net = Net::new();
    let a = net.join(1);
    let b = net.join(2);
    let c = net.join(3);
    let mic_a = net.publish(a, MediaKind::Audio, "mic-a");
    net.publish(b, MediaKind::Audio, "mic-b");
    let mic_c = net.publish(c, MediaKind::Audio, "mic-c");
    let cam_c = net.publish(c, MediaKind::Video, "cam-c");
    net.connect_all();
    net.run_for(Duration::from_millis(100));

    let c_on_a = [mid_from(&net, a, 3, "audio"), mid_from(&net, a, 3, "video")];
    let offers_before = net.signals_of(a, "offer").len();

    // The seat ended: the API deletes the session.
    let session_c = net.clients[c].session_id.clone();
    net.core.delete_session(net.now, &session_c);
    net.pump();
    net.run_for(Duration::from_millis(50));

    assert_eq!(net.signals_of(a, "offer").len(), offers_before + 1);
    let sdp = last_offer_sdp(&net, a);
    for mid in &c_on_a {
        assert_eq!(
            section_direction(&sdp, mid),
            stellarr_media::sdp_text::Direction::Inactive
        );
    }
    let users: Vec<&Value> = net
        .client(a)
        .directory
        .iter()
        .map(|t| &t["userId"])
        .collect();
    assert_eq!(users, [&Value::from(uuid(2))]);
    assert!(net.log.iter().all(|e| e["type"] != "closed"));

    // Nothing of C arrives any more, and A and B still hear each other.
    net.clients[c].blocked = false;
    let before = net.client(a).received.len();
    net.send_audio(c, mic_c, &[1]);
    send_video(&mut net, c, cam_c, &[2]);
    net.send_audio(a, mic_a, &[3]);
    net.run_for(Duration::from_millis(50));
    assert_eq!(net.client(a).received.len(), before);
    assert_eq!(
        payloads(&net, b, &mid_from(&net, b, 1, "audio")).last(),
        Some(&vec![3])
    );
}

#[test]
fn a_withdrawn_track_stops_and_leaves_the_directory() {
    let mut net = Net::new();
    let a = net.join(1);
    let b = net.join(2);
    let mic_a = net.publish(a, MediaKind::Audio, "share-a");
    let screen_a = net.publish(a, MediaKind::Video, "share-a");
    net.publish(b, MediaKind::Audio, "mic-b");
    net.connect_all();
    net.run_for(Duration::from_millis(100));
    let screen_on_b = mid_from(&net, b, 1, "video");

    // The screen share stops.
    net.offer(a, |api| api.set_direction(screen_a, Direction::Inactive))
        .1
        .unwrap();
    net.run_for(Duration::from_millis(50));

    let sdp = last_offer_sdp(&net, b);
    assert_eq!(
        section_direction(&sdp, &screen_on_b),
        stellarr_media::sdp_text::Direction::Inactive
    );
    assert_eq!(net.client(b).directory.len(), 1);
    assert_eq!(net.client(b).directory[0]["kind"], "audio");
    assert_eq!(net.core.stats(net.now).rooms[0].sessions[0].published, 1);

    // The sound goes on.
    net.send_audio(a, mic_a, &[4, 2]);
    net.run_for(Duration::from_millis(20));
    assert_eq!(
        payloads(&net, b, &mid_from(&net, b, 1, "audio")),
        [vec![4, 2]]
    );

    // A share that starts again gets a new section; sections are not reused.
    let screen_again = net.publish(a, MediaKind::Video, "share-a2");
    net.run_for(Duration::from_millis(50));
    let new_on_b = mid_from(&net, b, 1, "video");
    assert_ne!(new_on_b, screen_on_b);
    send_video(&mut net, a, screen_again, &[8, 8]);
    net.run_for(Duration::from_millis(20));
    assert_eq!(payloads(&net, b, &new_on_b), [vec![8, 8]]);
    assert!(payloads(&net, b, &screen_on_b).is_empty());
}

#[test]
fn an_offer_collision_is_resolved_by_the_polite_media_server() {
    let mut net = Net::new();
    let a = net.join(1);
    let b = net.join(2);
    net.publish(a, MediaKind::Audio, "mic-a");
    net.publish(b, MediaKind::Audio, "mic-b");
    net.connect_all();

    // The media server offers A's new camera to B, and B, before it has
    // answered, offers its own camera. B ignores the server's offer, as an
    // impolite browser does.
    net.clients[b].ignore_offers = true;
    let cam_a = net.publish(a, MediaKind::Video, "cam-a");
    let collided = net.signals_of(b, "offer").last().unwrap()["payload"]["negotiationId"]
        .as_u64()
        .unwrap();
    net.clients[b].ignore_offers = false;
    let cam_b = net.publish(b, MediaKind::Video, "cam-b");

    // The media server rolled its offer back, answered B, and offered again.
    let kinds: Vec<(String, Option<u64>)> = net
        .events_of(b)
        .iter()
        .map(|e| {
            (
                e["kind"].as_str().unwrap().to_string(),
                e["payload"]["negotiationId"].as_u64(),
            )
        })
        .collect();
    let tail = &kinds[kinds.len() - 3..];
    assert_eq!(tail[0], ("offer".to_string(), Some(collided)));
    assert_eq!(tail[1], ("answer".to_string(), None));
    assert_eq!(tail[2], ("offer".to_string(), Some(collided + 1)));
    assert_eq!(net.client(b).answer_results.last(), Some(&Ok(())));

    // An answer to the rolled back offer is stale.
    let session_b = net.clients[b].session_id.clone();
    let stale = net
        .core
        .answer(net.now, &session_b, &last_offer_sdp(&net, b), collided);
    assert_eq!(stale, Err(stellarr_media::core::ApiError::StaleNegotiation));

    net.run_for(Duration::from_millis(100));
    send_video(&mut net, a, cam_a, &[1, 1]);
    send_video(&mut net, b, cam_b, &[2, 2]);
    net.run_for(Duration::from_millis(20));
    assert_eq!(
        payloads(&net, b, &mid_from(&net, b, 1, "video")),
        [vec![1, 1]]
    );
    assert_eq!(
        payloads(&net, a, &mid_from(&net, a, 2, "video")),
        [vec![2, 2]]
    );
}

#[test]
fn the_bind_address_differs_from_every_advertised_address() {
    // The socket of the media server is bound to some container address the
    // browsers never see. It advertises a public address and the container
    // address coturn relays to, and a browser behind a relay knows only the
    // second one.
    let mut net = Net::with_candidates(&[PUBLIC, CONTAINER]);
    let direct = net.join(1);
    let relayed = net.join(2);
    net.clients[relayed].only_candidate = Some(addr(CONTAINER));

    let mic_direct = net.publish(direct, MediaKind::Audio, "mic-1");
    let mic_relayed = net.publish(relayed, MediaKind::Audio, "mic-2");
    net.connect_all();

    // The candidates are in the contract's order: public first.
    let answer = net.signals_of(direct, "answer")[0]["payload"]["sdp"]
        .as_str()
        .unwrap()
        .to_string();
    let candidates: Vec<&str> = answer
        .lines()
        .filter(|l| l.starts_with("a=candidate:"))
        .collect();
    assert_eq!(candidates.len(), 2);
    assert!(
        candidates[0].contains(" 203.0.113.7 49000 typ host"),
        "{candidates:?}"
    );
    assert!(
        candidates[1].contains(" 172.18.0.2 49000 typ host"),
        "{candidates:?}"
    );
    assert!(!answer.contains("a=candidate") || !answer.contains("10.9.9.9"));

    assert_eq!(net.client(relayed).target, Some(addr(CONTAINER)));
    assert_eq!(net.client(direct).target, Some(addr(PUBLIC)));

    for n in 0..5u8 {
        net.send_audio(direct, mic_direct, &[1, n]);
        net.send_audio(relayed, mic_relayed, &[2, n]);
        net.step(Duration::from_millis(20));
    }
    assert_eq!(
        payloads(&net, relayed, &mid_from(&net, relayed, 1, "audio")).len(),
        5
    );
    assert_eq!(
        payloads(&net, direct, &mid_from(&net, direct, 2, "audio")).len(),
        5
    );
}

#[test]
fn a_browser_whose_public_address_changes_keeps_its_session() {
    let mut net = Net::new();
    let a = net.join(1);
    let b = net.join(2);
    net.clients[a].public = Some(addr("198.51.100.20:40000"));
    let mic_a = net.publish(a, MediaKind::Audio, "mic-a");
    let mic_b = net.publish(b, MediaKind::Audio, "mic-b");
    net.connect_all();
    net.run_for(Duration::from_secs(1));

    // A's NAT moves it to another public port. Once its next check has come
    // from there, what it sends is routed by the new address.
    net.clients[a].public = Some(addr("198.51.100.20:40001"));
    net.run_for(Duration::from_secs(3));
    let a_on_b = mid_from(&net, b, 1, "audio");
    for n in 0..5u8 {
        net.send_audio(a, mic_a, &[1, n]);
        net.step(Duration::from_millis(20));
    }
    assert_eq!(payloads(&net, b, &a_on_b).len(), 5);

    // What A receives follows later. An ICE-lite agent sends on the best
    // pair the browser nominated, and both pairs rank the same, so str0m
    // keeps the old one until it drops it 15 seconds after its last check.
    net.run_for(Duration::from_secs(15));
    let b_on_a = mid_from(&net, a, 2, "audio");
    for n in 0..5u8 {
        net.send_audio(b, mic_b, &[2, n]);
        net.step(Duration::from_millis(20));
    }
    assert_eq!(payloads(&net, a, &b_on_a).len(), 5);
    assert!(net.log.iter().all(|e| e["type"] != "closed"));
    let stats = net.core.stats(net.now);
    assert!(
        stats.rooms[0]
            .sessions
            .iter()
            .all(|s| s.state == "connected")
    );
}

#[test]
fn checks_are_taken_from_a_bounded_number_of_addresses() {
    let mut net = Net::new();
    let a = net.join(1);
    // A's own datagrams never reach the media server; the test sends A's
    // first connectivity check itself.
    net.clients[a].blocked = true;
    net.publish(a, MediaKind::Audio, "mic-a");
    let mut check = None;
    while check.is_none() {
        net.now += Duration::from_millis(5);
        let rtc = &mut net.clients[a].rtc;
        rtc.handle_input(Input::Timeout(net.now)).unwrap();
        while let Ok(output) = rtc.poll_output() {
            match output {
                Output::Transmit(t) if stellarr_media::stun::is_stun(&t.contents) => {
                    check.get_or_insert(t.contents.to_vec());
                }
                Output::Timeout(_) => break,
                _ => {}
            }
        }
    }
    let check = check.unwrap();
    let answered = |net: &mut Net, from: SocketAddr| {
        net.core.handle_datagram(net.now, from, &check);
        net.core
            .take_outgoing()
            .iter()
            .any(|o| o.destination == from)
    };

    // Whoever holds a session's credentials can send one valid check from
    // as many addresses as it likes. Each new one is a remote candidate
    // str0m keeps and compares every later check with, so only so many are
    // taken.
    let sources: Vec<SocketAddr> = (0..MAX_SOURCE_ADDRS + 20)
        .map(|n| addr(&format!("198.51.100.{}:{}", n % 200 + 1, 2000 + n)))
        .collect();
    for (n, from) in sources.iter().enumerate() {
        assert_eq!(
            answered(&mut net, *from),
            n < MAX_SOURCE_ADDRS,
            "source {n}"
        );
    }
    // An address already taken still is, and IPv6 never is.
    assert!(answered(&mut net, sources[0]));
    assert!(!answered(&mut net, addr("[2001:db8::1]:2000")));
}

#[test]
fn checks_from_many_addresses_leave_the_media_address_routed() {
    let mut net = Net::new();
    let a = net.join(1);
    // A's first check is taken before it reaches the media server, so the
    // test can send it again from other addresses later.
    net.clients[a].blocked = true;
    let mic_a = net.publish(a, MediaKind::Audio, "mic-a");
    let mut check = None;
    while check.is_none() {
        net.now += Duration::from_millis(5);
        let rtc = &mut net.clients[a].rtc;
        rtc.handle_input(Input::Timeout(net.now)).unwrap();
        while let Ok(output) = rtc.poll_output() {
            match output {
                Output::Transmit(t) if stellarr_media::stun::is_stun(&t.contents) => {
                    check.get_or_insert(t.contents.to_vec());
                }
                Output::Timeout(_) => break,
                _ => {}
            }
        }
    }
    let check = check.unwrap();
    net.clients[a].blocked = false;
    let b = net.join(2);
    net.publish(b, MediaKind::Audio, "mic-b");
    net.connect_all();
    net.run_for(Duration::from_secs(1));
    let a_on_b = mid_from(&net, b, 1, "audio");

    // A browser on a machine with many interfaces (virtual adapters, VPNs,
    // container bridges) keeps checking its backup pairs from every one of
    // them while its media leaves through one. Chromium on the end-to-end
    // test machine used eleven.
    for n in 0..12u16 {
        net.core.handle_datagram(
            net.now,
            addr(&format!("198.51.100.50:{}", 3000 + n)),
            &check,
        );
    }
    net.core.take_outgoing();

    for n in 0..5u8 {
        net.send_audio(a, mic_a, &[1, n]);
        net.step(Duration::from_millis(20));
    }
    assert_eq!(payloads(&net, b, &a_on_b).len(), 5);
}

#[test]
fn keyframes_are_asked_for_at_the_start_and_for_receivers_at_most_once_a_second() {
    let mut net = Net::new();
    let a = net.join(1);
    let b = net.join(2);
    let cam_a = net.publish(a, MediaKind::Video, "cam-a");
    net.publish(b, MediaKind::Audio, "mic-b");
    net.connect_all();
    net.run_for(Duration::from_millis(100));

    let requests = |net: &Net| -> Vec<KeyframeRequestKind> {
        net.client(a)
            .events
            .iter()
            .filter_map(|e| match e {
                Event::KeyframeRequest(r) if r.mid == cam_a => Some(r.kind),
                _ => None,
            })
            .collect()
    };
    assert!(requests(&net).is_empty());

    // The first forwarded packet starts the section and asks for a keyframe.
    send_video(&mut net, a, cam_a, &[1]);
    net.run_for(Duration::from_millis(50));
    assert_eq!(requests(&net), [KeyframeRequestKind::Pli]);

    // B asks three times in quick succession; the publisher hears one more
    // request, a second after the last one.
    let cam_on_b: Mid = mid_from(&net, b, 1, "video").as_str().into();
    let started = net.now;
    for _ in 0..3 {
        net.clients[b]
            .rtc
            .direct_api()
            .stream_rx_by_mid(cam_on_b, None)
            .expect("B receives the camera")
            .request_keyframe(KeyframeRequestKind::Fir);
        net.step(Duration::from_millis(100));
    }
    assert_eq!(requests(&net).len(), 1, "held inside the window");

    net.run_for(Duration::from_millis(1200));
    assert_eq!(
        requests(&net),
        [KeyframeRequestKind::Pli, KeyframeRequestKind::Fir]
    );
    assert!(net.now - started < Duration::from_secs(2));

    net.run_for(Duration::from_secs(2));
    assert_eq!(requests(&net).len(), 2, "nothing more without a request");
}

#[test]
fn congestion_feedback_runs_on_each_connection_separately() {
    let mut net = Net::new();
    // A estimates its uplink, which it can only do from the feedback the
    // media server sends it about what arrived.
    let a = net.join_with(ROOM, 1, |c| c.enable_bwe(Some(Bitrate::kbps(300))));
    let b = net.join(2);
    let c = net.join(3);
    let cam_a = net.publish(a, MediaKind::Video, "cam-a");
    net.publish(b, MediaKind::Audio, "mic-b");
    let mic_c = net.publish(c, MediaKind::Audio, "mic-c");
    net.connect_all();
    net.run_for(Duration::from_millis(100));
    net.clients[a].events.clear();

    // Three seconds of media, long enough for an estimate to move.
    for n in 0..150u8 {
        send_video(&mut net, a, cam_a, &[n; 600]);
        net.send_audio(c, mic_c, &[n]);
        net.step(Duration::from_millis(20));
    }

    assert!(
        net.client(a)
            .has_event(|e| matches!(e, Event::EgressBitrateEstimate(_))),
        "the media server's feedback reached the publisher"
    );

    // What B receives carries the transport-wide numbers of B's own
    // connection: one unbroken sequence over the tracks of both publishers,
    // which their own numbering could never give.
    let numbers: Vec<u16> = net
        .client(b)
        .received
        .iter()
        .map(|r| {
            r.packet
                .header
                .ext_vals
                .transport_cc
                .expect("a transport-wide number")
        })
        .collect();
    assert_eq!(numbers.len(), 300);
    let mut sorted = numbers.clone();
    sorted.sort_unstable();
    assert!(sorted.windows(2).all(|w| w[1] == w[0] + 1), "{numbers:?}");
}

#[test]
fn losses_are_repaired_on_each_connection_separately() {
    let mut net = Net::new();
    let a = net.join(1);
    let b = net.join(2);
    let cam_a = net.publish(a, MediaKind::Video, "cam-a");
    net.publish(b, MediaKind::Audio, "mic-b");
    net.connect_all();
    net.run_for(Duration::from_millis(100));

    // One packet is lost on the publisher's uplink and another on the
    // receiver's downlink. The media server asks the publisher to resend
    // the first, and resends the second itself from what it forwarded.
    let a_vp8 = *net.client(a).pt_of(Codec::Vp8);
    let b_vp8 = *net.client(b).pt_of(Codec::Vp8);
    net.clients[a].lose_outgoing = Some((a_vp8, 3));
    net.clients[b].lose_incoming = Some((b_vp8, 6));

    for n in 1..=10u8 {
        send_video(&mut net, a, cam_a, &[n, n]);
        net.step(Duration::from_millis(30));
    }
    net.run_for(Duration::from_secs(1));

    assert!(
        net.client(a).lose_outgoing.is_none(),
        "the uplink loss happened"
    );
    assert!(
        net.client(b).lose_incoming.is_none(),
        "the downlink loss happened"
    );
    let mut got = payloads(&net, b, &mid_from(&net, b, 1, "video"));
    got.sort();
    let expected: Vec<Vec<u8>> = (1..=10u8).map(|n| vec![n, n]).collect();
    assert_eq!(got, expected);
}
