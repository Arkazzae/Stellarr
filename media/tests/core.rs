//! The core on its own: rooms, the directory, negotiation, the limits, the
//! timers and the event log. Most of these tests exchange no datagram at all;
//! the clients only produce and apply descriptions.

mod common;

use std::time::Duration;

use common::*;
use serde_json::{Value, json};
use stellarr_media::core::{ApiError, MAX_PUBLISHED};
use stellarr_media::sdp_text;
use str0m::change::{SdpAnswer, SdpOffer};
use str0m::media::{Direction, MediaKind};

fn offer_events(net: &Net, i: usize) -> Vec<Value> {
    net.signals_of(i, "offer").into_iter().cloned().collect()
}

fn last_offer(net: &Net, i: usize) -> Value {
    offer_events(net, i).last().cloned().expect("an offer")
}

/// Answers a media server offer by hand, for tests that decide when.
fn answer_for(net: &mut Net, i: usize, offer: &Value) -> String {
    let sdp = offer["payload"]["sdp"].as_str().unwrap();
    let offer = SdpOffer::from_sdp_string(sdp).unwrap();
    let answer = net.clients[i].rtc.sdp_api().accept_offer(offer).unwrap();
    answer.to_sdp_string()
}

#[test]
fn sessions_join_rooms_and_an_account_keeps_one_session() {
    let mut net = Net::offline();
    let a = net.join(1);
    let _b = net.join(2);
    let other_room = "00000000-0000-4000-8000-00000000bbbb";
    let _c = net.join_with(other_room, 3, |c| c);

    let health = net.core.health();
    assert_eq!((health.rooms, health.sessions), (2, 3));
    assert_eq!(health.status, "ok");
    assert_eq!(health.epoch, "epoch-1");

    // The same account again replaces its first session, silently.
    let old = net.clients[a].session_id.clone();
    let replacement = net.core.create_session(net.now, ROOM, &uuid(1)).unwrap();
    assert_ne!(replacement.session_id, old);
    assert_eq!(replacement.epoch, "epoch-1");
    assert!(!net.core.has_session(&old));
    assert_eq!(net.core.health().sessions, 3);
    assert_eq!(
        net.core.offer(net.now, &old, "v=0"),
        Err(ApiError::UnknownSession)
    );
    net.pump();
    assert!(
        net.log.is_empty(),
        "a replaced session ends without an event"
    );

    for (room, user) in [("not-a-uuid", uuid(9)), (ROOM, "9".to_string())] {
        let refused = net.core.create_session(net.now, room, &user);
        assert!(matches!(refused, Err(ApiError::InvalidRequest(_))));
    }
}

#[test]
fn the_browser_offers_first_and_the_answer_comes_before_the_next_offer() {
    let mut net = Net::offline();
    let a = net.join(1);
    let b = net.join(2);

    let mid_a = net.publish(a, MediaKind::Audio, "mic-a");
    // B has offered nothing yet, so the media server does not offer to it.
    assert!(net.events_of(b).is_empty());

    net.publish(b, MediaKind::Audio, "mic-b");
    let kinds: Vec<_> = net.events_of(b).iter().map(|e| e["kind"].clone()).collect();
    assert_eq!(kinds, [json!("answer"), json!("offer")]);

    let offer = last_offer(&net, b);
    assert_eq!(offer["payload"]["type"], "offer");
    assert_eq!(offer["payload"]["negotiationId"], 1);
    let tracks = offer["payload"]["tracks"].as_array().unwrap();
    assert_eq!(tracks.len(), 1);
    assert_eq!(tracks[0]["userId"], uuid(1));
    assert_eq!(tracks[0]["kind"], "audio");
    assert_eq!(tracks[0]["streamId"], "mic-a");

    // The directory names the section by the mid in the SDP, character for
    // character.
    let mid = tracks[0]["mid"].as_str().unwrap();
    let sections = sdp_text::sections(offer["payload"]["sdp"].as_str().unwrap());
    let section = sections
        .iter()
        .find(|s| s.mid == mid)
        .expect("the mid is in the description");
    assert_eq!(section.direction, sdp_text::Direction::SendOnly);
    // The msid of a forwarded section is the publisher's stream id.
    assert_eq!(section.stream_id.as_deref(), Some("mic-a"));
    assert_ne!(mid, &*mid_a, "the media server chooses its own mids");

    // A gets B's track the same way once B publishes.
    assert_eq!(
        last_offer(&net, a)["payload"]["tracks"][0]["userId"],
        uuid(2)
    );

    // Event sequence numbers grow by one.
    let seqs: Vec<u64> = net.log.iter().map(|e| e["seq"].as_u64().unwrap()).collect();
    assert_eq!(seqs, (1..=seqs.len() as u64).collect::<Vec<_>>());
}

#[test]
fn negotiation_ids_number_the_offers_of_one_session() {
    let mut net = Net::offline();
    let a = net.join(1);
    let b = net.join(2);
    net.publish(a, MediaKind::Audio, "mic-a");
    net.publish(b, MediaKind::Audio, "mic-b");
    net.publish(a, MediaKind::Video, "camera-a");
    net.publish(a, MediaKind::Video, "screen-a");

    assert_eq!(net.client(b).offers_seen, [1, 2, 3]);
    assert!(net.client(b).answer_results.iter().all(|r| r.is_ok()));
    assert_eq!(net.client(a).offers_seen, [1]);

    // The directory grows with every track and names each one once.
    let directory = &net.client(b).directory;
    assert_eq!(directory.len(), 3);
    let streams: Vec<&str> = directory
        .iter()
        .map(|t| t["streamId"].as_str().unwrap())
        .collect();
    assert_eq!(streams, ["mic-a", "camera-a", "screen-a"]);
}

#[test]
fn an_answer_to_another_offer_is_stale() {
    let mut net = Net::offline();
    let a = net.join(1);
    let b = net.join(2);
    net.clients[b].ignore_offers = true;
    let session = net.clients[b].session_id.clone();

    // No offer is pending yet.
    assert_eq!(
        net.core.answer(net.now, &session, "v=0", 1),
        Err(ApiError::StaleNegotiation)
    );

    net.publish(b, MediaKind::Audio, "mic-b");
    net.publish(a, MediaKind::Audio, "mic-a");
    let offer = last_offer(&net, b);
    assert_eq!(offer["payload"]["negotiationId"], 1);
    let answer = answer_for(&mut net, b, &offer);

    assert_eq!(
        net.core.answer(net.now, &session, &answer, 7),
        Err(ApiError::StaleNegotiation)
    );
    // A malformed answer to the right offer leaves that offer waiting.
    assert!(matches!(
        net.core.answer(net.now, &session, "not sdp", 1),
        Err(ApiError::InvalidSdp(_))
    ));
    let too_big = format!("{answer}{}", "a=x\r\n".repeat(30_000));
    assert!(matches!(
        net.core.answer(net.now, &session, &too_big, 1),
        Err(ApiError::InvalidSdp(_))
    ));
    assert_eq!(net.core.answer(net.now, &session, &answer, 1), Ok(()));

    // Once answered, the same number is stale.
    assert_eq!(
        net.core.answer(net.now, &session, &answer, 1),
        Err(ApiError::StaleNegotiation)
    );
    assert_eq!(
        net.core.answer(net.now, "nobody", &answer, 1),
        Err(ApiError::UnknownSession)
    );
}

#[test]
fn an_unanswered_offer_is_issued_again_and_the_third_closes_the_session() {
    let mut net = Net::new();
    let a = net.join(1);
    let b = net.join(2);
    net.publish(a, MediaKind::Audio, "mic-a");
    net.publish(b, MediaKind::Audio, "mic-b");
    net.connect_all();

    net.clients[b].ignore_offers = true;
    net.publish(a, MediaKind::Video, "camera-a");
    let first = last_offer(&net, b);
    assert_eq!(first["payload"]["negotiationId"], 2);

    net.run_for(Duration::from_millis(9_900));
    assert_eq!(offer_events(&net, b).len(), 2, "not yet");

    net.run_for(Duration::from_millis(200));
    let second = last_offer(&net, b);
    assert_eq!(second["payload"]["negotiationId"], 3);
    // The offer was rolled back and made again, so its new section is new.
    let first_mids: Vec<&Value> = first["payload"]["tracks"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| &t["mid"])
        .collect();
    let second_mids: Vec<&Value> = second["payload"]["tracks"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| &t["mid"])
        .collect();
    assert_eq!(first_mids.len(), 2);
    assert_eq!(first_mids[0], second_mids[0], "the live section stays");
    assert_ne!(
        first_mids[1], second_mids[1],
        "the rolled back section is offered anew"
    );

    net.run_for(Duration::from_secs(10));
    assert_eq!(last_offer(&net, b)["payload"]["negotiationId"], 4);
    assert_eq!(net.client(b).closed, None);

    net.run_for(Duration::from_secs(10));
    assert_eq!(net.client(b).closed.as_deref(), Some("error"));
    assert!(!net.core.has_session(&net.clients[b].session_id));
    assert_eq!(
        offer_events(&net, b).len(),
        4,
        "the third unanswered offer is the last"
    );

    // A stops forwarding to B and is told so.
    let a_tracks = net.client(a).directory.clone();
    assert!(
        a_tracks.is_empty(),
        "B's microphone is gone from A's directory: {a_tracks:?}"
    );
}

#[test]
fn an_answer_resets_the_count_of_unanswered_offers() {
    let mut net = Net::new();
    let a = net.join(1);
    let b = net.join(2);
    net.publish(a, MediaKind::Audio, "mic-a");
    net.publish(b, MediaKind::Audio, "mic-b");
    net.connect_all();

    net.clients[b].ignore_offers = true;
    net.publish(a, MediaKind::Video, "camera-a");
    net.run_for(Duration::from_secs(21));
    assert_eq!(offer_events(&net, b).len(), 4, "two offers went unanswered");

    // B answers the third.
    let offer = last_offer(&net, b);
    let answer = answer_for(&mut net, b, &offer);
    let session = net.clients[b].session_id.clone();
    let id = offer["payload"]["negotiationId"].as_u64().unwrap();
    assert_eq!(net.core.answer(net.now, &session, &answer, id), Ok(()));

    // Two more unanswered offers do not close the session.
    net.publish(a, MediaKind::Video, "screen-a");
    net.run_for(Duration::from_secs(21));
    assert_eq!(net.client(b).closed, None);
    assert!(net.core.has_session(&session));
}

#[test]
fn a_session_that_never_connects_is_closed_after_30_seconds() {
    let mut net = Net::offline();
    let a = net.join(1);
    let b = net.join(2);
    net.publish(a, MediaKind::Audio, "mic-a");

    net.run_for(Duration::from_millis(29_900));
    assert_eq!(net.client(a).closed, None);
    let stats = net.core.stats(net.now);
    let states: Vec<&str> = stats.rooms[0].sessions.iter().map(|s| s.state).collect();
    assert_eq!(states, ["connecting", "new"]);

    net.run_for(Duration::from_millis(200));
    assert_eq!(net.client(a).closed.as_deref(), Some("transport-timeout"));
    assert_eq!(net.client(b).closed.as_deref(), Some("transport-timeout"));
    assert_eq!(net.core.health().sessions, 0);
    assert_eq!(net.core.health().rooms, 0);
}

#[test]
fn a_session_that_stays_disconnected_is_closed_after_30_seconds() {
    let mut net = Net::new();
    let a = net.join(1);
    let b = net.join(2);
    net.publish(a, MediaKind::Audio, "mic-a");
    net.publish(b, MediaKind::Audio, "mic-b");
    net.connect_all();
    net.run_for(Duration::from_secs(1));

    // A's network goes away. ICE-lite notices when the checks stop.
    net.clients[a].blocked = true;
    net.run_until(Duration::from_secs(30), |n| {
        n.core.stats(n.now).rooms[0].sessions[0].state == "disconnected"
    });
    let disconnected_at = net.now;

    net.run_for(Duration::from_millis(29_800));
    assert_eq!(net.client(a).closed, None);
    assert_eq!(net.client(b).closed, None);

    net.run_until(Duration::from_millis(400), |n| n.client(a).closed.is_some());
    assert_eq!(net.client(a).closed.as_deref(), Some("transport-timeout"));
    assert!(net.now - disconnected_at >= Duration::from_secs(30));

    // B is still fine and is told A's microphone is gone.
    assert_eq!(net.client(b).closed, None);
    assert!(net.client(b).directory.is_empty());
}

#[test]
fn a_connection_that_recovers_in_time_survives() {
    let mut net = Net::new();
    // A browser keeps checking a connection that went quiet for a while
    // before it gives up on it; this client is told to do the same.
    let a = net.join_with(ROOM, 1, |mut c| {
        c.set_max_stun_retransmits(1000);
        c.set_max_stun_rto(Duration::from_secs(1));
        c
    });
    let b = net.join(2);
    let mid_a = net.publish(a, MediaKind::Audio, "mic-a");
    net.publish(b, MediaKind::Audio, "mic-b");
    net.connect_all();

    net.clients[a].blocked = true;
    net.run_until(Duration::from_secs(30), |n| {
        n.core.stats(n.now).rooms[0].sessions[0].state == "disconnected"
    });
    net.run_for(Duration::from_secs(10));
    net.clients[a].blocked = false;
    net.run_until(Duration::from_secs(15), |n| {
        n.core.stats(n.now).rooms[0].sessions[0].state == "connected"
    });
    net.run_for(Duration::from_secs(40));
    assert_eq!(net.client(a).closed, None);

    let before = net.client(b).received.len();
    net.send_audio(a, mid_a, &[1, 2, 3]);
    net.run_for(Duration::from_millis(50));
    assert_eq!(net.client(b).received.len(), before + 1);
}

#[test]
fn publishing_more_than_eight_tracks_is_refused() {
    let mut net = Net::offline();
    let a = net.join(1);
    let b = net.join(2);
    net.publish(b, MediaKind::Audio, "mic-b");

    let (_, refused) = net.offer(a, |api| {
        for n in 0..=MAX_PUBLISHED {
            api.add_media(
                MediaKind::Audio,
                Direction::SendOnly,
                Some(format!("s{n}")),
                None,
                None,
            );
        }
    });
    assert!(matches!(refused, Err(ApiError::LimitExceeded(_))));
    assert_eq!(net.core.stats(net.now).rooms[0].sessions[0].published, 0);

    // A refused offer leaves no trace, and eight are fine.
    let (_, accepted) = net.offer(a, |api| {
        for n in 0..MAX_PUBLISHED {
            api.add_media(
                MediaKind::Video,
                Direction::SendOnly,
                Some(format!("s{n}")),
                None,
                None,
            );
        }
    });
    assert_eq!(accepted, Ok(()));
    assert_eq!(net.core.stats(net.now).rooms[0].sessions[0].published, 8);
    assert_eq!(net.client(b).directory.len(), 8);

    // A ninth on top of eight is refused, and the eight stay.
    let (_, refused) = net.offer(a, |api| {
        api.add_media(
            MediaKind::Audio,
            Direction::SendOnly,
            Some("s9".into()),
            None,
            None,
        );
    });
    assert!(matches!(refused, Err(ApiError::LimitExceeded(_))));
    assert_eq!(net.core.stats(net.now).rooms[0].sessions[0].published, 8);
}

#[test]
fn an_oversized_or_malformed_description_is_refused_and_the_session_lives_on() {
    let mut net = Net::offline();
    let a = net.join(1);
    let session = net.clients[a].session_id.clone();

    let huge = format!("v=0\r\n{}", "a=x\r\n".repeat(30_000));
    assert!(huge.len() > 128 * 1024);
    assert!(matches!(
        net.core.offer(net.now, &session, &huge),
        Err(ApiError::InvalidSdp(_))
    ));
    assert!(matches!(
        net.core.offer(net.now, &session, "garbage"),
        Err(ApiError::InvalidSdp(_))
    ));
    assert!(matches!(
        net.core.offer(net.now, &session, ""),
        Err(ApiError::InvalidSdp(_))
    ));

    // A description without a fingerprint would make str0m drop the whole
    // connection, so it is refused before it gets there.
    let (_, ok) = net.offer_with(
        a,
        |api| api.add_media(MediaKind::Audio, Direction::SendOnly, None, None, None),
        |sdp| {
            sdp.lines()
                .filter(|l| !l.starts_with("a=fingerprint"))
                .collect::<Vec<_>>()
                .join("\r\n")
                + "\r\n"
        },
    );
    assert!(matches!(ok, Err(ApiError::InvalidSdp(_))));

    assert_eq!(
        net.core.offer(net.now, "nobody", "v=0"),
        Err(ApiError::UnknownSession)
    );

    // The session still takes a good offer.
    net.publish(a, MediaKind::Audio, "mic-a");
    assert_eq!(net.signals_of(a, "answer").len(), 1);
    assert!(net.log.iter().all(|e| e["type"] != "closed"));
}

#[test]
fn an_offer_of_the_media_server_larger_than_128_kib_closes_the_session() {
    let mut net = Net::offline();
    let receiver = net.join(100);
    net.publish(receiver, MediaKind::Audio, "mic");

    // Enough publishers of video to make one description too large.
    let mut user = 1;
    while net.client(receiver).closed.is_none() {
        assert!(user < 20, "the offer never grew past the limit");
        let p = net.join(user);
        net.offer(p, |api| {
            for n in 0..MAX_PUBLISHED {
                api.add_media(
                    MediaKind::Video,
                    Direction::SendOnly,
                    Some(format!("s{n}")),
                    None,
                    None,
                );
            }
        })
        .1
        .unwrap();
        user += 1;
    }

    assert_eq!(net.client(receiver).closed.as_deref(), Some("error"));
    for offer in offer_events(&net, receiver) {
        assert!(offer["payload"]["sdp"].as_str().unwrap().len() <= 128 * 1024);
    }
}

#[test]
fn sessions_closed_through_the_api_never_produce_a_closed_event() {
    let mut net = Net::offline();
    let a = net.join(1);
    let b = net.join(2);
    let c = net.join(3);
    net.publish(a, MediaKind::Audio, "mic-a");
    net.publish(b, MediaKind::Audio, "mic-b");
    net.publish(c, MediaKind::Audio, "mic-c");

    net.core
        .delete_session(net.now, &net.clients[a].session_id.clone());
    net.core.delete_session(net.now, "unknown");
    net.core.create_session(net.now, ROOM, &uuid(2)).unwrap();
    net.pump();

    assert!(net.log.iter().all(|e| e["type"] != "closed"));
    // C is told that A and B are gone.
    let directory = &net.client(c).directory;
    assert!(directory.is_empty(), "{directory:?}");

    let seq_before = net.core.last_seq();
    let reset = net.core.reset(net.now);
    net.pump();
    assert_eq!(reset.epoch, "epoch-1");
    assert_eq!(reset.seq, seq_before);
    assert_eq!(net.core.last_seq(), seq_before, "a reset says nothing");
    assert_eq!(net.core.health().sessions, 0);
}

#[test]
fn the_event_log_reports_its_epoch_and_window_through_the_core() {
    let mut net = Net::offline();
    let a = net.join(1);
    net.publish(a, MediaKind::Audio, "mic-a");

    let poll = net.core.events(Some("epoch-1"), 0);
    assert!(!poll.reset);
    assert_eq!(poll.events.len(), 1);

    let poll = net.core.events(Some("an-old-epoch"), 0);
    assert!(poll.reset);
    assert_eq!(poll.epoch, "epoch-1");
    assert!(poll.events.is_empty());
}

#[test]
fn a_new_stream_id_alone_sends_the_directory_without_an_offer() {
    let mut net = Net::offline();
    let a = net.join(1);
    let b = net.join(2);
    let mid_a = net.publish(a, MediaKind::Video, "camera-1");
    net.publish(b, MediaKind::Audio, "mic-b");
    let offers_before = offer_events(&net, b).len();

    // The publisher replaced its camera and the stream id changed. The
    // client's change itself (a receive-only section) publishes nothing.
    let (_, ok) = net.offer_with(
        a,
        |api| api.add_media(MediaKind::Audio, Direction::RecvOnly, None, None, None),
        |sdp| sdp.replace("camera-1", "camera-2"),
    );
    ok.unwrap();

    assert_eq!(
        offer_events(&net, b).len(),
        offers_before,
        "no SDP exchange"
    );
    let tracks = net.signals_of(b, "tracks");
    assert_eq!(tracks.len(), 1);
    let directory = tracks[0]["payload"]["tracks"].as_array().unwrap();
    assert_eq!(directory.len(), 1);
    assert_eq!(directory[0]["streamId"], "camera-2");
    assert_eq!(directory[0]["userId"], uuid(1));

    // The receive-only section of the publisher was answered inactive.
    let answer = net.signals_of(a, "answer").last().unwrap()["payload"]["sdp"]
        .as_str()
        .unwrap()
        .to_string();
    let sections = sdp_text::sections(&answer);
    assert_eq!(
        sections.last().unwrap().direction,
        sdp_text::Direction::Inactive
    );
    assert_eq!(net.core.stats(net.now).rooms[0].sessions[0].published, 1);
    let _ = mid_a;
}

/// The codec that leads the section `mid` of a description.
fn leading_codec(sdp: &str, mid: &str) -> String {
    let mut section = None;
    for line in sdp.lines() {
        if line.starts_with("m=") {
            section = Some(line);
        }
        if line == format!("a=mid:{mid}") {
            break;
        }
    }
    let first_pt = section.unwrap().split_whitespace().nth(3).unwrap();
    let rtpmap = format!("a=rtpmap:{first_pt} ");
    let line = sdp.lines().find(|l| l.starts_with(&rtpmap)).unwrap();
    line[rtpmap.len()..].split('/').next().unwrap().to_string()
}

#[test]
fn the_codec_order_of_the_publisher_holds_in_answers_and_offers() {
    let mut net = Net::offline();
    let vp8_first = net.join_with(ROOM, 1, |c| {
        c.clear_codecs()
            .enable_opus(true, false)
            .enable_vp8(true)
            .enable_vp9(true)
    });
    let vp9_first = net.join_with(ROOM, 2, |c| {
        c.clear_codecs()
            .enable_opus(true, false)
            .enable_vp9(true)
            .enable_vp8(true)
    });

    let mut cameras = Vec::new();
    for (i, first) in [(vp8_first, "VP8"), (vp9_first, "VP9")] {
        let mid = net.publish(i, MediaKind::Video, "camera");
        let answer = net.signals_of(i, "answer")[0]["payload"]["sdp"]
            .as_str()
            .unwrap()
            .to_string();
        assert_eq!(leading_codec(&answer, &mid), first, "in the answer");
        cameras.push((i, mid, first));
    }

    // Every later offer of the media server repeats the publisher's own
    // sections, and a browser that answers it may switch to the codec the
    // offer puts first, so the order holds there too.
    for (i, mid, first) in cameras {
        let offers = net.signals_of(i, "offer");
        assert!(!offers.is_empty());
        for offer in offers {
            let sdp = offer["payload"]["sdp"].as_str().unwrap();
            assert_eq!(leading_codec(sdp, &mid), first, "in an offer");
        }
    }
}

#[test]
fn rooms_do_not_see_each_other() {
    let mut net = Net::new();
    let a = net.join(1);
    let b = net.join(2);
    let other_room = "00000000-0000-4000-8000-00000000bbbb";
    let c = net.join_with(other_room, 3, |c| c);
    let d = net.join_with(other_room, 4, |c| c);

    let mic_a = net.publish(a, MediaKind::Audio, "mic-a");
    net.publish(b, MediaKind::Audio, "mic-b");
    let mic_c = net.publish(c, MediaKind::Audio, "mic-c");
    net.publish(d, MediaKind::Audio, "mic-d");
    net.connect_all();

    for (i, other) in [(a, 2), (b, 1), (c, 4), (d, 3)] {
        let users: Vec<&Value> = net
            .client(i)
            .directory
            .iter()
            .map(|t| &t["userId"])
            .collect();
        assert_eq!(users, [&Value::from(uuid(other))], "client {i}");
    }

    net.send_audio(a, mic_a, &[1]);
    net.send_audio(c, mic_c, &[3]);
    net.run_for(Duration::from_millis(50));
    let payloads = |i: usize| -> Vec<Vec<u8>> {
        net.client(i)
            .received
            .iter()
            .map(|r| r.packet.payload.to_vec())
            .collect()
    };
    assert_eq!(payloads(b), [vec![1]]);
    assert_eq!(payloads(d), [vec![3]]);
    assert!(payloads(a).is_empty() && payloads(c).is_empty());
    assert_eq!(net.core.stats(net.now).rooms.len(), 2);
}

#[test]
fn browser_candidates_are_used_ignored_or_refused() {
    let mut net = Net::offline();
    let a = net.join(1);
    net.publish(a, MediaKind::Audio, "mic-a");
    let session = net.clients[a].session_id.clone();
    let now = net.now;

    let host = json!({ "candidate": "candidate:1 1 udp 2130706431 10.0.0.1 5000 typ host", "sdpMid": "0", "sdpMLineIndex": 0 });
    assert_eq!(net.core.candidate(now, &session, Some(&host)), Ok(()));
    assert_eq!(net.core.candidate(now, &session, None), Ok(()));

    for ignored in [
        json!({ "candidate": "" }),
        json!({ "candidate": "candidate:2 1 udp 2130706431 4b1e1c3a-7f1e-4f6e-9a7c-1c2b3d4e5f60.local 5000 typ host" }),
        json!({ "candidate": "candidate:3 1 udp 2130706431 2001:db8::1 5000 typ host" }),
        json!({ "candidate": "candidate:4 1 tcp 1518280447 10.0.0.1 9 typ host tcptype active" }),
    ] {
        assert_eq!(
            net.core.candidate(now, &session, Some(&ignored)),
            Ok(()),
            "{ignored}"
        );
    }

    for refused in [
        json!({ "candidate": "candidate:garbage" }),
        json!({ "candidate": 7 }),
        json!({ "sdpMid": "0" }),
    ] {
        assert!(
            matches!(
                net.core.candidate(now, &session, Some(&refused)),
                Err(ApiError::InvalidCandidate(_))
            ),
            "{refused}"
        );
    }

    assert_eq!(
        net.core.candidate(now, "nobody", None),
        Err(ApiError::UnknownSession)
    );
}

#[test]
fn garbage_datagrams_are_dropped_without_an_answer() {
    let mut net = Net::new();
    let a = net.join(1);
    let b = net.join(2);
    let mid_a = net.publish(a, MediaKind::Audio, "mic-a");
    net.publish(b, MediaKind::Audio, "mic-b");
    net.connect_all();

    let stranger = addr("198.51.100.9:4000");
    let mut stun = vec![0x00, 0x01, 0x00, 0x08, 0x21, 0x12, 0xa4, 0x42];
    stun.extend_from_slice(&[1; 12]);
    stun.extend_from_slice(&[0x00, 0x06, 0x00, 0x03, b'a', b':', b'b', 0]);
    let garbage: Vec<Vec<u8>> = vec![
        vec![],
        vec![0; 1],
        vec![0xff; 3000],
        vec![0x80, 0x6f, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 2, 3],
        vec![0x16, 0xfe, 0xfd, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0xff],
        stun,
        (0..=255u8).collect(),
    ];
    for bytes in &garbage {
        net.core.handle_datagram(net.now, stranger, bytes);
    }
    assert!(
        net.core.take_outgoing().is_empty(),
        "nothing answers a stranger"
    );

    // Garbage from a known address does not hurt the session either.
    let known = net.clients[a].addr;
    for bytes in &garbage {
        net.core.handle_datagram(net.now, known, bytes);
    }
    net.flush();
    net.run_for(Duration::from_millis(100));
    assert!(net.log.iter().all(|e| e["type"] != "closed"));

    let before = net.client(b).received.len();
    net.send_audio(a, mid_a, &[9, 9, 9]);
    net.run_for(Duration::from_millis(50));
    assert_eq!(net.client(b).received.len(), before + 1);
}

#[test]
fn answers_are_applied_by_the_client_as_given() {
    // The harness applies every answer with str0m. This checks the text the
    // core emits is a complete description, not just something str0m on the
    // core's side would accept.
    let mut net = Net::offline();
    let a = net.join(1);
    net.publish(a, MediaKind::Audio, "mic-a");
    let answer = net.signals_of(a, "answer")[0]["payload"]["sdp"]
        .as_str()
        .unwrap()
        .to_string();
    assert!(SdpAnswer::from_sdp_string(&answer).is_ok());
    assert!(answer.contains("a=ice-lite"));
    assert!(answer.contains("a=recvonly"));
}

#[test]
fn an_unanswered_withdrawal_is_offered_again() {
    let mut net = Net::new();
    let a = net.join(1);
    let b = net.join(2);
    let cam_a = net.publish(a, MediaKind::Video, "cam-a");
    net.publish(b, MediaKind::Audio, "mic-b");
    net.connect_all();
    let cam_on_b = net.client(b).directory[0]["mid"]
        .as_str()
        .unwrap()
        .to_string();

    net.clients[b].ignore_offers = true;
    net.offer(a, |api| api.set_direction(cam_a, Direction::Inactive))
        .1
        .unwrap();
    let withdrawal = last_offer(&net, b);
    let direction = |offer: &Value| {
        let sdp = offer["payload"]["sdp"].as_str().unwrap();
        sdp_text::sections(sdp)
            .into_iter()
            .find(|s| s.mid == cam_on_b)
            .unwrap()
            .direction
    };
    assert_eq!(direction(&withdrawal), sdp_text::Direction::Inactive);
    assert!(
        withdrawal["payload"]["tracks"]
            .as_array()
            .unwrap()
            .is_empty()
    );

    // The offer times out. Its withdrawal was already applied inside str0m,
    // and still has to reach the browser.
    net.run_for(Duration::from_millis(10_100));
    let again = last_offer(&net, b);
    assert_eq!(
        again["payload"]["negotiationId"],
        withdrawal["payload"]["negotiationId"].as_u64().unwrap() + 1
    );
    assert_eq!(direction(&again), sdp_text::Direction::Inactive);

    net.clients[b].ignore_offers = false;
    let answer = answer_for(&mut net, b, &again);
    let session = net.clients[b].session_id.clone();
    let id = again["payload"]["negotiationId"].as_u64().unwrap();
    assert_eq!(net.core.answer(net.now, &session, &answer, id), Ok(()));

    // Settled: nothing more to offer.
    let count = offer_events(&net, b).len();
    net.run_for(Duration::from_secs(11));
    assert_eq!(offer_events(&net, b).len(), count);
    assert_eq!(net.client(b).closed, None);
}

#[test]
fn a_track_withdrawn_while_its_section_is_offered_is_made_inactive_next() {
    let mut net = Net::offline();
    let a = net.join(1);
    let b = net.join(2);
    net.publish(a, MediaKind::Audio, "mic-a");
    net.publish(b, MediaKind::Audio, "mic-b");

    net.clients[b].ignore_offers = true;
    let cam_a = net.publish(a, MediaKind::Video, "cam-a");
    let adding = last_offer(&net, b);
    let cam_on_b = adding["payload"]["tracks"]
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["kind"] == "video")
        .unwrap()["mid"]
        .as_str()
        .unwrap()
        .to_string();

    // The camera is gone before B answers the offer that adds it.
    net.offer(a, |api| api.set_direction(cam_a, Direction::Inactive))
        .1
        .unwrap();
    let answer = answer_for(&mut net, b, &adding);
    let session = net.clients[b].session_id.clone();
    let id = adding["payload"]["negotiationId"].as_u64().unwrap();
    net.core.answer(net.now, &session, &answer, id).unwrap();
    net.pump();

    let next = last_offer(&net, b);
    assert_eq!(next["payload"]["negotiationId"], id + 1);
    let sdp = next["payload"]["sdp"].as_str().unwrap();
    let section = sdp_text::sections(sdp)
        .into_iter()
        .find(|s| s.mid == cam_on_b)
        .unwrap();
    assert_eq!(section.direction, sdp_text::Direction::Inactive);
    let tracks = next["payload"]["tracks"].as_array().unwrap();
    assert!(tracks.iter().all(|t| t["mid"] != cam_on_b.as_str()));
}

#[test]
fn a_track_sent_again_before_its_withdrawal_is_answered_gets_a_new_section() {
    let mut net = Net::offline();
    let a = net.join(1);
    let b = net.join(2);
    let cam_a = net.publish(a, MediaKind::Video, "cam-a");
    net.publish(b, MediaKind::Audio, "mic-b");
    let first_on_b = net.client(b).directory[0]["mid"]
        .as_str()
        .unwrap()
        .to_string();

    // A turns its camera off and on again on the same transceiver while B
    // has not answered the offer that withdraws it.
    net.clients[b].ignore_offers = true;
    net.offer(a, |api| api.set_direction(cam_a, Direction::Inactive))
        .1
        .unwrap();
    let withdrawal = last_offer(&net, b);
    net.offer(a, |api| api.set_direction(cam_a, Direction::SendOnly))
        .1
        .unwrap();
    assert_eq!(net.core.stats(net.now).rooms[0].sessions[0].published, 1);

    net.clients[b].ignore_offers = false;
    let answer = answer_for(&mut net, b, &withdrawal);
    let session = net.clients[b].session_id.clone();
    let id = withdrawal["payload"]["negotiationId"].as_u64().unwrap();
    assert_eq!(net.core.answer(net.now, &session, &answer, id), Ok(()));
    net.pump();

    // B is offered the camera again, on a section of its own, and the old
    // one stays inactive.
    let next = last_offer(&net, b);
    assert_eq!(next["payload"]["negotiationId"], id + 1);
    let directory = &net.client(b).directory;
    assert_eq!(directory.len(), 1, "{directory:?}");
    assert_eq!(directory[0]["userId"], uuid(1));
    assert_eq!(directory[0]["kind"], "video");
    let second_on_b = directory[0]["mid"].as_str().unwrap();
    assert_ne!(second_on_b, first_on_b);
    let sdp = next["payload"]["sdp"].as_str().unwrap();
    let direction = |mid: &str| {
        sdp_text::sections(sdp)
            .into_iter()
            .find(|s| s.mid == mid)
            .unwrap()
            .direction
    };
    assert_eq!(direction(&first_on_b), sdp_text::Direction::Inactive);
    assert_eq!(direction(second_on_b), sdp_text::Direction::SendOnly);
    assert!(net.client(b).answer_results.iter().all(Result::is_ok));
}

#[test]
fn a_track_sent_again_while_its_first_offer_is_pending_gets_a_new_section() {
    let mut net = Net::offline();
    let a = net.join(1);
    let b = net.join(2);
    net.publish(a, MediaKind::Audio, "mic-a");
    net.publish(b, MediaKind::Audio, "mic-b");

    // The offer that brings A's camera to B is pending while A turns the
    // camera off and on again on the same transceiver.
    net.clients[b].ignore_offers = true;
    let cam_a = net.publish(a, MediaKind::Video, "cam-a");
    let adding = last_offer(&net, b);
    let first_on_b = adding["payload"]["tracks"]
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["kind"] == "video")
        .unwrap()["mid"]
        .as_str()
        .unwrap()
        .to_string();
    net.offer(a, |api| api.set_direction(cam_a, Direction::Inactive))
        .1
        .unwrap();
    net.offer(a, |api| api.set_direction(cam_a, Direction::SendOnly))
        .1
        .unwrap();

    net.clients[b].ignore_offers = false;
    let answer = answer_for(&mut net, b, &adding);
    let session = net.clients[b].session_id.clone();
    let id = adding["payload"]["negotiationId"].as_u64().unwrap();
    assert_eq!(net.core.answer(net.now, &session, &answer, id), Ok(()));
    net.pump();

    let videos: Vec<&Value> = net
        .client(b)
        .directory
        .iter()
        .filter(|t| t["kind"] == "video")
        .collect();
    assert_eq!(videos.len(), 1, "{:?}", net.client(b).directory);
    assert_eq!(videos[0]["userId"], uuid(1));
    assert_ne!(videos[0]["mid"], first_on_b.as_str());
    assert!(net.client(b).answer_results.iter().all(Result::is_ok));
}

/// The Opus parameters of one section of a description.
fn opus_fmtp(sdp: &str, mid: &str) -> Option<String> {
    sdp_text::opus_params(sdp, |m| m == mid)
        .into_iter()
        .next()
        .map(|(_, params)| params)
}

/// Gives every Opus payload type of a description these parameters, as the
/// web client does to its local descriptions.
fn with_opus_fmtp(sdp: &str, params: &str) -> String {
    let opus: Vec<String> = sdp
        .lines()
        .filter_map(|l| l.strip_prefix("a=rtpmap:"))
        .filter(|rest| rest.to_ascii_lowercase().contains(" opus/"))
        .filter_map(|rest| rest.split(' ').next())
        .map(str::to_string)
        .collect();
    sdp.split("\r\n")
        .map(|line| match line.strip_prefix("a=fmtp:") {
            Some(rest) if opus.iter().any(|pt| rest.starts_with(&format!("{pt} "))) => {
                format!("a=fmtp:{} {params}", rest.split(' ').next().unwrap())
            }
            _ => line.to_string(),
        })
        .collect::<Vec<_>>()
        .join("\r\n")
}

#[test]
fn the_publisher_s_opus_parameters_come_back_in_answers_and_offers() {
    let mut net = Net::offline();
    let a = net.join(1);
    let b = net.join(2);

    // A browser's Opus encoder follows the parameters of the other side's
    // description, so what A asks for must come back to it.
    let tuned = "minptime=10;useinbandfec=1;stereo=1;maxaveragebitrate=128000;usedtx=0";
    let (mid_a, result) = net.offer_with(
        a,
        |api| {
            api.add_media(
                MediaKind::Audio,
                Direction::SendOnly,
                Some("mic-a".into()),
                None,
                None,
            )
        },
        |sdp| with_opus_fmtp(&sdp, tuned),
    );
    result.expect("the offer is accepted");
    let answer = net.signals_of(a, "answer")[0]["payload"]["sdp"]
        .as_str()
        .unwrap()
        .to_string();
    assert_eq!(opus_fmtp(&answer, &mid_a).as_deref(), Some(tuned));

    // B tuned nothing and gets what str0m writes.
    let mid_b = net.publish(b, MediaKind::Audio, "mic-b");
    let answer_b = net.signals_of(b, "answer")[0]["payload"]["sdp"]
        .as_str()
        .unwrap()
        .to_string();
    assert_eq!(
        opus_fmtp(&answer_b, &mid_b).as_deref(),
        Some("minptime=10;useinbandfec=1")
    );

    // The offer that brings B's microphone to A repeats A's own section,
    // which keeps A's parameters. The section that forwards B's microphone
    // is the media server's own and keeps str0m's.
    let offer = last_offer(&net, a);
    let sdp = offer["payload"]["sdp"].as_str().unwrap();
    assert_eq!(opus_fmtp(sdp, &mid_a).as_deref(), Some(tuned));
    let forwarded = offer["payload"]["tracks"][0]["mid"].as_str().unwrap();
    assert_eq!(
        opus_fmtp(sdp, forwarded).as_deref(),
        Some("minptime=10;useinbandfec=1")
    );
    assert!(net.client(a).answer_results.iter().all(Result::is_ok));
}

/// A real offer of Chromium 153 for a microphone and a camera, with the Opus
/// parameters the web client writes, scrubbed of its addresses.
const CHROMIUM_OFFER: &str = include_str!("fixtures/chromium-offer.sdp");

#[test]
fn a_chromium_offer_is_answered_with_its_codec_order_and_its_opus_parameters() {
    let mut net = Net::offline();
    let a = net.join(1);
    let sdp = CHROMIUM_OFFER.replace("\r\n", "\n").replace('\n', "\r\n");
    let session = net.clients[a].session_id.clone();

    net.core
        .offer(net.now, &session, &sdp)
        .expect("a Chromium offer is accepted");

    let answer = net
        .core
        .events(Some("epoch-1"), 0)
        .events
        .iter()
        .map(|e| serde_json::to_value(&**e).unwrap())
        .find(|e| e["kind"] == "answer")
        .expect("an answer");
    let answer = answer["payload"]["sdp"].as_str().unwrap();

    let directions: Vec<_> = sdp_text::sections(answer)
        .iter()
        .map(|s| (s.mid.clone(), s.direction))
        .collect();
    assert_eq!(
        directions,
        [
            ("0".to_string(), sdp_text::Direction::RecvOnly),
            ("1".to_string(), sdp_text::Direction::RecvOnly)
        ]
    );
    // Chromium puts VP8 first unless told otherwise, and sends what the
    // answer puts first.
    assert_eq!(leading_codec(answer, "1"), "VP8");
    assert_eq!(
        opus_fmtp(answer, "0").as_deref(),
        Some(
            "maxaveragebitrate=128000;minptime=10;sprop-stereo=0;stereo=0;usedtx=0;useinbandfec=1"
        )
    );
    assert_eq!(net.core.stats(net.now).rooms[0].sessions[0].published, 2);
}
