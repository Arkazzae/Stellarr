//! The ordered log of everything the media server says to browsers.
//!
//! Every signal for a browser goes through this one log: the answer to a
//! browser offer as much as the media server's own offers and directories.
//! The API relays the log in order, which is what keeps an answer from
//! overtaking the offer that follows it.

use std::collections::VecDeque;
use std::sync::Arc;

use serde::Serialize;
use serde_json::Value;

/// How many events the media server keeps for a poll that falls behind.
pub const RETAINED_EVENTS: usize = 4096;

/// The most events one poll returns.
pub const MAX_EVENTS_PER_POLL: usize = 256;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SignalKind {
    Offer,
    Answer,
    Tracks,
}

/// Why the media plane ended a session. Sessions closed through the control
/// API have no reason: they end without an event.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum CloseReason {
    TransportTimeout,
    Error,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(
    tag = "type",
    rename_all = "lowercase",
    rename_all_fields = "camelCase"
)]
pub enum EventBody {
    Signal {
        session_id: String,
        kind: SignalKind,
        payload: Value,
    },
    Closed {
        session_id: String,
        reason: CloseReason,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Event {
    pub seq: u64,
    #[serde(flatten)]
    pub body: EventBody,
}

/// The answer to one poll of `GET /v1/events`.
#[derive(Debug, Clone, Serialize)]
pub struct Poll {
    pub epoch: String,
    pub reset: bool,
    pub events: Vec<Arc<Event>>,
}

#[derive(Debug)]
pub struct EventLog {
    epoch: String,
    last_seq: u64,
    events: VecDeque<Arc<Event>>,
}

impl EventLog {
    pub fn new(epoch: String) -> EventLog {
        EventLog {
            epoch,
            last_seq: 0,
            events: VecDeque::with_capacity(RETAINED_EVENTS),
        }
    }

    pub fn epoch(&self) -> &str {
        &self.epoch
    }

    /// The sequence number of the newest event, 0 before the first one.
    pub fn last_seq(&self) -> u64 {
        self.last_seq
    }

    pub fn push(&mut self, body: EventBody) -> u64 {
        self.last_seq += 1;
        if self.events.len() == RETAINED_EVENTS {
            self.events.pop_front();
        }
        self.events.push_back(Arc::new(Event {
            seq: self.last_seq,
            body,
        }));
        self.last_seq
    }

    /// The events after `after`, or a reset when the poller cannot continue
    /// from where it is.
    ///
    /// A poller must start over when it names another run of the process,
    /// when the events it has not seen are no longer kept, and when it claims
    /// to have seen events that were never issued. The last case cannot
    /// happen to a correct poller, and resetting is the only answer that
    /// cannot leave it waiting for a sequence number that will mean something
    /// else when it arrives.
    pub fn read(&self, epoch: Option<&str>, after: u64) -> Poll {
        let first_kept = self.events.front().map_or(self.last_seq + 1, |e| e.seq);
        let reset =
            epoch != Some(self.epoch.as_str()) || after > self.last_seq || after + 1 < first_kept;

        let events = if reset {
            Vec::new()
        } else {
            let skip = (after + 1 - first_kept) as usize;
            self.events
                .iter()
                .skip(skip)
                .take(MAX_EVENTS_PER_POLL)
                .cloned()
                .collect()
        };

        Poll {
            epoch: self.epoch.clone(),
            reset,
            events,
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn tracks(session: &str) -> EventBody {
        EventBody::Signal {
            session_id: session.into(),
            kind: SignalKind::Tracks,
            payload: json!({ "tracks": [] }),
        }
    }

    #[test]
    fn numbers_events_from_one_in_order() {
        let mut log = EventLog::new("e1".into());
        assert_eq!(log.last_seq(), 0);

        assert_eq!(log.push(tracks("a")), 1);
        assert_eq!(log.push(tracks("b")), 2);

        let poll = log.read(Some("e1"), 0);
        assert!(!poll.reset);
        assert_eq!(
            poll.events.iter().map(|e| e.seq).collect::<Vec<_>>(),
            [1, 2]
        );

        let poll = log.read(Some("e1"), 1);
        assert_eq!(poll.events.iter().map(|e| e.seq).collect::<Vec<_>>(), [2]);

        let poll = log.read(Some("e1"), 2);
        assert!(!poll.reset);
        assert!(poll.events.is_empty());
    }

    #[test]
    fn serialises_to_the_contract_shape() {
        let mut log = EventLog::new("e1".into());
        log.push(EventBody::Signal {
            session_id: "s1".into(),
            kind: SignalKind::Answer,
            payload: json!({ "type": "answer", "sdp": "v=0" }),
        });
        log.push(EventBody::Closed {
            session_id: "s1".into(),
            reason: CloseReason::TransportTimeout,
        });

        let poll = serde_json::to_value(log.read(Some("e1"), 0)).unwrap();

        assert_eq!(
            poll,
            json!({
                "epoch": "e1",
                "reset": false,
                "events": [
                    { "seq": 1, "type": "signal", "sessionId": "s1", "kind": "answer",
                      "payload": { "type": "answer", "sdp": "v=0" } },
                    { "seq": 2, "type": "closed", "sessionId": "s1", "reason": "transport-timeout" }
                ]
            })
        );
        assert_eq!(
            serde_json::to_value(CloseReason::Error).unwrap(),
            json!("error")
        );
    }

    #[test]
    fn returns_at_most_256_events_per_poll() {
        let mut log = EventLog::new("e1".into());
        for _ in 0..300 {
            log.push(tracks("a"));
        }

        let first = log.read(Some("e1"), 0);
        assert_eq!(first.events.len(), MAX_EVENTS_PER_POLL);
        assert_eq!(first.events.last().unwrap().seq, 256);

        let rest = log.read(Some("e1"), 256);
        assert_eq!(rest.events.len(), 44);
        assert_eq!(rest.events[0].seq, 257);
    }

    #[test]
    fn keeps_the_last_4096_events() {
        let mut log = EventLog::new("e1".into());
        for _ in 0..RETAINED_EVENTS + 10 {
            log.push(tracks("a"));
        }

        // Events 1 to 10 are gone, so a poller that saw only 9 has a gap.
        assert!(log.read(Some("e1"), 9).reset);
        assert!(log.read(Some("e1"), 0).reset);

        // A poller that saw 10 continues without a gap.
        let poll = log.read(Some("e1"), 10);
        assert!(!poll.reset);
        assert_eq!(poll.events[0].seq, 11);
    }

    #[test]
    fn resets_a_poller_of_another_epoch() {
        let mut log = EventLog::new("e2".into());
        log.push(tracks("a"));

        for epoch in [Some("e1"), Some(""), None] {
            let poll = log.read(epoch, 0);
            assert!(poll.reset);
            assert_eq!(poll.epoch, "e2");
            assert!(poll.events.is_empty());
        }
    }

    #[test]
    fn resets_a_poller_ahead_of_the_log() {
        let mut log = EventLog::new("e1".into());
        log.push(tracks("a"));

        assert!(log.read(Some("e1"), 2).reset);
        assert!(!log.read(Some("e1"), 1).reset);
    }
}
