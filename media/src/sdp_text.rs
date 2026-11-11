//! Small readers and rewriters of SDP text.
//!
//! str0m parses SDP into its own session model, but some facts the media
//! server needs are either not exposed or not kept up to date there: the msid
//! a browser gives a section on a later offer, the direction exactly as the
//! browser wrote it, the order of the payload types it prefers and the Opus
//! parameters it asks for. These
//! helpers work on the text and are deliberately forgiving: anything they do
//! not understand is left as it is, and str0m remains the judge of validity.

use std::collections::HashSet;

/// The media type of an m-line.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SectionKind {
    Audio,
    Video,
    Other,
}

/// A direction as the author of the description wrote it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Direction {
    SendRecv,
    SendOnly,
    RecvOnly,
    Inactive,
}

impl Direction {
    fn parse(attribute: &str) -> Option<Direction> {
        match attribute {
            "a=sendrecv" => Some(Direction::SendRecv),
            "a=sendonly" => Some(Direction::SendOnly),
            "a=recvonly" => Some(Direction::RecvOnly),
            "a=inactive" => Some(Direction::Inactive),
            _ => None,
        }
    }

    fn attribute(self) -> &'static str {
        match self {
            Direction::SendRecv => "a=sendrecv",
            Direction::SendOnly => "a=sendonly",
            Direction::RecvOnly => "a=recvonly",
            Direction::Inactive => "a=inactive",
        }
    }

    /// Whether the author of the description sends on this section.
    pub fn is_sending(self) -> bool {
        matches!(self, Direction::SendRecv | Direction::SendOnly)
    }
}

/// One media section of a description.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Section {
    pub mid: String,
    pub kind: SectionKind,
    pub direction: Direction,
    /// Port zero outside the BUNDLE group: the section is rejected or stopped.
    /// With max-bundle a browser also writes port zero for bundled sections,
    /// which are not rejected.
    pub rejected: bool,
    /// The stream id of `a=msid`, or `None` when the section names no stream.
    pub stream_id: Option<String>,
}

struct Parsed<'a> {
    session: Vec<&'a str>,
    sections: Vec<Vec<&'a str>>,
}

fn split(sdp: &str) -> Parsed<'_> {
    let mut session = Vec::new();
    let mut sections: Vec<Vec<&str>> = Vec::new();

    for line in sdp.split('\n') {
        let line = line.strip_suffix('\r').unwrap_or(line);
        if line.is_empty() {
            continue;
        }
        if line.starts_with("m=") {
            sections.push(vec![line]);
        } else if let Some(section) = sections.last_mut() {
            section.push(line);
        } else {
            session.push(line);
        }
    }

    Parsed { session, sections }
}

fn join(lines: impl IntoIterator<Item = String>) -> String {
    let mut out = String::new();
    for line in lines {
        out.push_str(&line);
        out.push_str("\r\n");
    }
    out
}

fn mid_of(lines: &[&str]) -> Option<String> {
    lines
        .iter()
        .find_map(|l| l.strip_prefix("a=mid:"))
        .map(|m| m.trim().to_string())
}

fn direction_of(lines: &[&str]) -> Option<Direction> {
    lines.iter().find_map(|l| Direction::parse(l.trim()))
}

fn bundle_mids(session: &[&str]) -> HashSet<String> {
    session
        .iter()
        .filter_map(|l| l.strip_prefix("a=group:BUNDLE"))
        .flat_map(|rest| rest.split_whitespace())
        .map(str::to_string)
        .collect()
}

fn stream_of(lines: &[&str]) -> Option<String> {
    // `a=msid:<stream> [<track>]` is the unified-plan way. Older stacks only
    // carry the pair on the SSRC: `a=ssrc:<n> msid:<stream> <track>`.
    let stream = lines
        .iter()
        .find_map(|l| l.strip_prefix("a=msid:"))
        .or_else(|| {
            lines.iter().find_map(|l| {
                let rest = l.strip_prefix("a=ssrc:")?;
                let (_, attribute) = rest.split_once(' ')?;
                attribute.strip_prefix("msid:")
            })
        })?
        .split_whitespace()
        .next()?;

    (stream != "-").then(|| stream.to_string())
}

/// The media sections of a description, in order.
pub fn sections(sdp: &str) -> Vec<Section> {
    let parsed = split(sdp);
    let bundled = bundle_mids(&parsed.session);
    let session_direction = direction_of(&parsed.session).unwrap_or(Direction::SendRecv);

    parsed
        .sections
        .iter()
        .map(|lines| {
            let mut tokens = lines[0]["m=".len()..].split_whitespace();
            let kind = match tokens.next() {
                Some("audio") => SectionKind::Audio,
                Some("video") => SectionKind::Video,
                _ => SectionKind::Other,
            };
            let port_zero = tokens.next().is_some_and(|p| p == "0");
            let mid = mid_of(lines).unwrap_or_default();
            let bundle_only = lines.iter().any(|l| l.trim() == "a=bundle-only");

            Section {
                rejected: port_zero && !bundle_only && !bundled.contains(&mid),
                direction: direction_of(lines).unwrap_or(session_direction),
                stream_id: stream_of(lines),
                kind,
                mid,
            }
        })
        .collect()
}

/// How many sections of a browser description publish media towards the
/// media server. Sections the media server created never count: a browser
/// cannot publish on them.
pub fn count_published(sections: &[Section], is_server_mid: impl Fn(&str) -> bool) -> usize {
    sections
        .iter()
        .filter(|s| s.kind != SectionKind::Other)
        .filter(|s| !s.rejected && s.direction.is_sending())
        .filter(|s| !is_server_mid(&s.mid))
        .count()
}

/// Narrows the directions of a browser offer to what the media server will
/// do with each section, before str0m answers it.
///
/// A section the browser created is only ever received, so `sendrecv` becomes
/// `sendonly` and `recvonly` becomes `inactive`. A section the media server
/// created is only ever sent, so `sendrecv` becomes `recvonly` and `sendonly`
/// becomes `inactive`. Without this a browser that reuses a receiving
/// transceiver for a new track, or adds tracks with the default `sendrecv`,
/// would be answered with directions nobody serves.
pub fn narrow_offer_directions(sdp: &str, is_server_mid: impl Fn(&str) -> bool) -> String {
    let parsed = split(sdp);
    let session_direction = direction_of(&parsed.session).unwrap_or(Direction::SendRecv);
    let mut out: Vec<String> = parsed.session.iter().map(|l| l.to_string()).collect();

    for lines in &parsed.sections {
        let is_media = lines[0].starts_with("m=audio") || lines[0].starts_with("m=video");
        let mid = mid_of(lines).unwrap_or_default();
        let current = direction_of(lines);
        let effective = current.unwrap_or(session_direction);

        let narrowed = if !is_media {
            effective
        } else if is_server_mid(&mid) {
            match effective {
                Direction::SendRecv => Direction::RecvOnly,
                Direction::SendOnly => Direction::Inactive,
                other => other,
            }
        } else {
            match effective {
                Direction::SendRecv => Direction::SendOnly,
                Direction::RecvOnly => Direction::Inactive,
                other => other,
            }
        };

        for line in lines {
            if Direction::parse(line.trim()).is_some() {
                out.push(narrowed.attribute().to_string());
            } else {
                out.push(line.to_string());
            }
        }
        if current.is_none() && narrowed != effective {
            out.push(narrowed.attribute().to_string());
        }
    }

    join(out)
}

/// The payload types of every section of a description, by mid, in the
/// order the author listed them.
pub type FormatOrders = Vec<(String, Vec<String>)>;

pub fn format_orders(sdp: &str) -> FormatOrders {
    split(sdp)
        .sections
        .iter()
        .map(|lines| {
            let formats = lines[0].split_whitespace().skip(3).map(str::to_string);
            (mid_of(lines).unwrap_or_default(), formats.collect())
        })
        .collect()
}

/// Puts the payload types of every section that `orders` knows in that
/// order.
///
/// A browser sends with the first codec the other side lists, whether in an
/// answer or in an offer it answers. str0m writes every description in its
/// own preference, so without this the media server, not the publisher, would
/// choose the codec of every track. The media server's descriptions are
/// therefore put in the order of the browser's last offer.
pub fn order_formats(sdp: &str, orders: &FormatOrders) -> String {
    let parsed = split(sdp);
    let mut out: Vec<String> = parsed.session.iter().map(|l| l.to_string()).collect();

    for lines in &parsed.sections {
        let mid = mid_of(lines).unwrap_or_default();
        let order = orders.iter().find(|(m, _)| *m == mid).map(|(_, f)| f);
        let tokens: Vec<&str> = lines[0].split_whitespace().collect();

        let m_line = match order {
            Some(order) if tokens.len() > 3 => {
                let mut formats = tokens[3..].to_vec();
                // A stable sort keeps formats the browser did not name in
                // str0m's order, after the ones it did.
                formats.sort_by_key(|f| order.iter().position(|o| o == f).unwrap_or(usize::MAX));
                let mut line = tokens[..3].join(" ");
                for f in formats {
                    line.push(' ');
                    line.push_str(f);
                }
                line
            }
            _ => lines[0].to_string(),
        };

        out.push(m_line);
        out.extend(lines[1..].iter().map(|l| l.to_string()));
    }

    join(out)
}

/// The Opus format parameters of some sections of a description, by mid,
/// exactly as the author wrote them.
pub type OpusParams = Vec<(String, String)>;

/// The payload types a section maps to Opus.
fn opus_pts<'a>(lines: &[&'a str]) -> Vec<&'a str> {
    lines
        .iter()
        .filter_map(|l| l.strip_prefix("a=rtpmap:"))
        .filter_map(|rest| rest.split_once(' '))
        .filter(|(_, codec)| {
            codec
                .split('/')
                .next()
                .is_some_and(|name| name.eq_ignore_ascii_case("opus"))
        })
        .map(|(pt, _)| pt)
        .collect()
}

/// The Opus `a=fmtp` parameters of every section that `include` names and
/// that has them.
pub fn opus_params(sdp: &str, include: impl Fn(&str) -> bool) -> OpusParams {
    split(sdp)
        .sections
        .iter()
        .filter_map(|lines| {
            let mid = mid_of(lines)?;
            if !include(&mid) {
                return None;
            }
            let pt = *opus_pts(lines).first()?;
            let prefix = format!("a=fmtp:{pt} ");
            let params = lines.iter().find_map(|l| l.strip_prefix(prefix.as_str()))?;
            Some((mid, params.trim().to_string()))
        })
        .collect()
}

/// Writes `params` as the Opus format parameters of the sections they name.
///
/// A browser configures its Opus encoder from the other side's description:
/// `maxaveragebitrate`, `stereo`, `usedtx`, `cbr` and `useinbandfec` there
/// say what the receiver wants, and the encoder obeys. str0m writes its own
/// defaults, which would set every publisher to a mono stream at the
/// browser's default rate whatever profile its client chose. The media
/// server only forwards, so it has no wish of its own; for each section a
/// browser publishes it hands the browser's own parameters back. They only
/// ever go back to the browser that wrote them, never to another one.
pub fn apply_opus_params(sdp: &str, params: &OpusParams) -> String {
    if params.is_empty() {
        return sdp.to_string();
    }
    let parsed = split(sdp);
    let mut out: Vec<String> = parsed.session.iter().map(|l| l.to_string()).collect();

    for lines in &parsed.sections {
        let wanted = mid_of(lines).and_then(|mid| {
            params
                .iter()
                .find(|(m, _)| *m == mid)
                .map(|(_, p)| p.as_str())
        });
        let Some(wanted) = wanted else {
            out.extend(lines.iter().map(|l| l.to_string()));
            continue;
        };

        let pts = opus_pts(lines);
        let has_fmtp = |pt: &str| {
            let prefix = format!("a=fmtp:{pt} ");
            lines.iter().any(|l| l.starts_with(&prefix))
        };
        for line in lines {
            let fmtp_pt = line
                .strip_prefix("a=fmtp:")
                .and_then(|rest| rest.split_once(' '))
                .map(|(pt, _)| pt);
            match fmtp_pt {
                Some(pt) if pts.contains(&pt) => out.push(format!("a=fmtp:{pt} {wanted}")),
                _ => out.push(line.to_string()),
            }
            // A payload type without parameters gets them after its rtpmap.
            let rtpmap_pt = line
                .strip_prefix("a=rtpmap:")
                .and_then(|rest| rest.split_once(' '))
                .map(|(pt, _)| pt);
            if let Some(pt) = rtpmap_pt
                && pts.contains(&pt)
                && !has_fmtp(pt)
            {
                out.push(format!("a=fmtp:{pt} {wanted}"));
            }
        }
    }

    join(out)
}

/// Whether the description carries a DTLS fingerprint anywhere. str0m tears
/// the whole connection down when the first remote description lacks one, so
/// such an offer is refused before it reaches str0m.
pub fn has_fingerprint(sdp: &str) -> bool {
    sdp.split('\n')
        .any(|l| l.trim_start().starts_with("a=fingerprint:"))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The shape of an offer Chrome makes with max-bundle: the microphone, a
    /// camera, and a section the media server created earlier.
    const CHROME: &str = "v=0\r\n\
o=- 4611731400430051336 2 IN IP4 127.0.0.1\r\n\
s=-\r\n\
t=0 0\r\n\
a=group:BUNDLE 0 1 svK\r\n\
a=extmap-allow-mixed\r\n\
a=msid-semantic: WMS 4c0d7e5b-1c4a-4c6e-9a43-6c5b0f1f7c11\r\n\
m=audio 9 UDP/TLS/RTP/SAVPF 111 63 9 0 8 13 110 126\r\n\
c=IN IP4 0.0.0.0\r\n\
a=ice-ufrag:abcd\r\n\
a=ice-pwd:abcdefghijklmnopqrstuvwx\r\n\
a=fingerprint:sha-256 00:11\r\n\
a=setup:actpass\r\n\
a=mid:0\r\n\
a=sendrecv\r\n\
a=msid:4c0d7e5b-1c4a-4c6e-9a43-6c5b0f1f7c11 7f3a\r\n\
a=rtpmap:111 opus/48000/2\r\n\
a=ssrc:1001 cname:x\r\n\
m=video 0 UDP/TLS/RTP/SAVPF 98 99 96 97 45 46\r\n\
c=IN IP4 0.0.0.0\r\n\
a=bundle-only\r\n\
a=mid:1\r\n\
a=sendonly\r\n\
a=msid:camera-stream camera-track\r\n\
m=audio 9 UDP/TLS/RTP/SAVPF 111\r\n\
a=mid:svK\r\n\
a=recvonly\r\n\
a=msid:- other\r\n";

    /// The shape of a Firefox offer: braces in the ids, no bundle-only, a
    /// stopped section and a section without any direction attribute.
    const FIREFOX: &str = "v=0\r\n\
o=mozilla...THIS_IS_SDPARTA-99.0 1 0 IN IP4 0.0.0.0\r\n\
s=-\r\n\
t=0 0\r\n\
a=fingerprint:sha-256 AA:BB\r\n\
a=group:BUNDLE 0 2\r\n\
m=audio 9 UDP/TLS/RTP/SAVPF 109 9 0 8\r\n\
a=mid:0\r\n\
a=sendonly\r\n\
a=msid:{7e1b4c6a-3a52-4c38-9a1c-46b3c9a3f0d0} {0a2b}\r\n\
m=video 0 UDP/TLS/RTP/SAVPF 120\r\n\
a=mid:1\r\n\
a=inactive\r\n\
m=video 9 UDP/TLS/RTP/SAVPF 120 124\r\n\
a=mid:2\r\n\
a=ssrc:77 msid:{screen} {track}\r\n";

    #[test]
    fn reads_the_sections_of_a_chrome_offer() {
        let s = sections(CHROME);

        assert_eq!(s.len(), 3);
        assert_eq!(s[0].mid, "0");
        assert_eq!(s[0].kind, SectionKind::Audio);
        assert_eq!(s[0].direction, Direction::SendRecv);
        assert_eq!(
            s[0].stream_id.as_deref(),
            Some("4c0d7e5b-1c4a-4c6e-9a43-6c5b0f1f7c11")
        );
        assert!(!s[0].rejected);

        // Port zero with bundle-only is a bundled section, not a rejected one.
        assert_eq!(s[1].kind, SectionKind::Video);
        assert!(!s[1].rejected);
        assert_eq!(s[1].stream_id.as_deref(), Some("camera-stream"));

        // `-` names no stream.
        assert_eq!(s[2].mid, "svK");
        assert_eq!(s[2].stream_id, None);
    }

    #[test]
    fn reads_the_sections_of_a_firefox_offer() {
        let s = sections(FIREFOX);

        assert_eq!(
            s[0].stream_id.as_deref(),
            Some("{7e1b4c6a-3a52-4c38-9a1c-46b3c9a3f0d0}")
        );
        assert_eq!(s[0].direction, Direction::SendOnly);

        // Port zero outside the BUNDLE group is a stopped section.
        assert!(s[1].rejected);

        // No direction attribute means sendrecv; the msid is on the SSRC.
        assert_eq!(s[2].direction, Direction::SendRecv);
        assert_eq!(s[2].stream_id.as_deref(), Some("{screen}"));
    }

    #[test]
    fn reads_bare_newlines_and_session_level_directions() {
        let sdp = "v=0\na=sendonly\nm=audio 9 RTP/AVP 0\na=mid:a\nm=audio 9 RTP/AVP 0\na=mid:b\na=inactive\n";
        let s = sections(sdp);

        assert_eq!(s[0].direction, Direction::SendOnly);
        assert_eq!(s[1].direction, Direction::Inactive);
        assert_eq!(s[0].stream_id, None);
    }

    #[test]
    fn counts_only_what_the_browser_publishes() {
        let server = |mid: &str| mid == "svK";

        assert_eq!(count_published(&sections(CHROME), server), 2);
        // A server section the browser would send on does not count.
        let reused = CHROME.replace("a=mid:svK\r\na=recvonly", "a=mid:svK\r\na=sendrecv");
        assert_eq!(count_published(&sections(&reused), server), 2);
        assert_eq!(count_published(&sections(FIREFOX), |_| false), 2);
    }

    #[test]
    fn narrows_directions_by_who_created_the_section() {
        let reused = CHROME.replace("a=mid:svK\r\na=recvonly", "a=mid:svK\r\na=sendrecv");
        let narrowed = narrow_offer_directions(&reused, |mid| mid == "svK");
        let s = sections(&narrowed);

        assert_eq!(s[0].direction, Direction::SendOnly);
        assert_eq!(s[1].direction, Direction::SendOnly);
        assert_eq!(s[2].direction, Direction::RecvOnly);

        // Everything else is kept, line by line.
        assert!(narrowed.contains("a=msid:camera-stream camera-track\r\n"));
        assert!(narrowed.contains("a=rtpmap:111 opus/48000/2\r\n"));
        assert_eq!(narrowed.lines().count(), reused.lines().count());
    }

    #[test]
    fn narrows_a_missing_direction_by_adding_one() {
        let narrowed = narrow_offer_directions(FIREFOX, |_| false);
        let s = sections(&narrowed);

        assert_eq!(s[2].direction, Direction::SendOnly);
        assert_eq!(s[1].direction, Direction::Inactive);

        let browser_receiving = "v=0\r\nm=audio 9 RTP/AVP 0\r\na=mid:0\r\na=recvonly\r\n";
        let narrowed = narrow_offer_directions(browser_receiving, |_| false);
        assert_eq!(sections(&narrowed)[0].direction, Direction::Inactive);

        let server_sending = "v=0\r\nm=video 9 RTP/AVP 96\r\na=mid:x\r\na=sendonly\r\n";
        let narrowed = narrow_offer_directions(server_sending, |m| m == "x");
        assert_eq!(sections(&narrowed)[0].direction, Direction::Inactive);
    }

    #[test]
    fn orders_answer_formats_like_the_offer() {
        let offer = "v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96 97 98 99 45 46\r\na=mid:1\r\n";
        let answer = "v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 98 99 96 97 45 46\r\na=mid:1\r\na=rtpmap:98 VP9/90000\r\n";

        let ordered = order_formats(answer, &format_orders(offer));

        assert!(ordered.contains("m=video 9 UDP/TLS/RTP/SAVPF 96 97 98 99 45 46\r\n"));
        assert!(ordered.contains("a=rtpmap:98 VP9/90000\r\n"));
    }

    #[test]
    fn keeps_unknown_formats_and_sections_in_place() {
        let offer = "v=0\r\nm=audio 9 RTP/AVP 111 0\r\na=mid:0\r\n";
        let answer =
            "v=0\r\nm=audio 9 RTP/AVP 0 8 111\r\na=mid:0\r\nm=audio 9 RTP/AVP 9\r\na=mid:7\r\n";

        let ordered = order_formats(answer, &format_orders(offer));

        assert!(ordered.contains("m=audio 9 RTP/AVP 111 0 8\r\n"));
        assert!(ordered.contains("m=audio 9 RTP/AVP 9\r\n"));
    }

    #[test]
    fn reads_the_opus_parameters_of_the_sections_asked_for() {
        let tuned = CHROME
            .replace(
                "a=rtpmap:111 opus/48000/2\r\na=ssrc",
                "a=rtpmap:111 opus/48000/2\r\na=fmtp:111 minptime=10;stereo=1\r\na=ssrc",
            )
            .replace(
                "a=mid:svK\r\na=recvonly\r\n",
                "a=mid:svK\r\na=recvonly\r\na=rtpmap:111 opus/48000/2\r\na=fmtp:111 x=1\r\n",
            );

        assert_eq!(
            opus_params(&tuned, |mid| mid != "svK"),
            [("0".to_string(), "minptime=10;stereo=1".to_string())]
        );
        assert_eq!(opus_params(&tuned, |_| true).len(), 2);
        // Sections without Opus parameters have nothing to read.
        assert!(opus_params(CHROME, |_| true).is_empty());
    }

    #[test]
    fn writes_opus_parameters_into_the_sections_they_name() {
        let answer = "v=0\r\n\
m=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=mid:0\r\na=rtpmap:111 opus/48000/2\r\na=fmtp:111 minptime=10\r\n\
m=audio 9 UDP/TLS/RTP/SAVPF 109\r\na=mid:1\r\na=rtpmap:109 OPUS/48000/2\r\na=sendonly\r\n\
m=video 9 UDP/TLS/RTP/SAVPF 96\r\na=mid:2\r\na=rtpmap:96 VP8/90000\r\na=fmtp:96 x=1\r\n\
m=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=mid:3\r\na=rtpmap:111 opus/48000/2\r\na=fmtp:111 minptime=10\r\n";
        let params = vec![
            (
                "0".to_string(),
                "stereo=1;maxaveragebitrate=128000".to_string(),
            ),
            ("1".to_string(), "usedtx=1".to_string()),
            ("2".to_string(), "stereo=1".to_string()),
        ];

        let written = apply_opus_params(answer, &params);

        assert!(written.contains(
            "a=mid:0\r\na=rtpmap:111 opus/48000/2\r\na=fmtp:111 stereo=1;maxaveragebitrate=128000\r\n"
        ));
        // A payload type without parameters gets them after its rtpmap.
        assert!(
            written.contains("a=rtpmap:109 OPUS/48000/2\r\na=fmtp:109 usedtx=1\r\na=sendonly\r\n")
        );
        // Other codecs and sections nobody named are left as they were.
        assert!(written.contains("a=fmtp:96 x=1\r\n"));
        assert!(
            written.ends_with("a=mid:3\r\na=rtpmap:111 opus/48000/2\r\na=fmtp:111 minptime=10\r\n")
        );
        assert_eq!(apply_opus_params(answer, &Vec::new()), answer);
    }

    #[test]
    fn finds_a_fingerprint_at_either_level() {
        assert!(has_fingerprint(CHROME));
        assert!(has_fingerprint(FIREFOX));
        assert!(!has_fingerprint("v=0\r\nm=audio 9 RTP/AVP 0\r\n"));
    }
}
