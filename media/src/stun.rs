//! The one piece of STUN the media server reads itself.
//!
//! Every session owns its own ICE credentials, so the USERNAME attribute of a
//! connectivity check names the session it is meant for. Reading it directly
//! turns the demultiplexing of a first check into one map lookup instead of a
//! walk over every `Rtc` of the instance.

const HEADER_LEN: usize = 20;
const MAGIC_COOKIE: [u8; 4] = [0x21, 0x12, 0xa4, 0x42];
const ATTRIBUTE_USERNAME: u16 = 0x0006;

/// Whether a datagram looks like STUN (RFC 7983 demultiplexing plus the
/// magic cookie of RFC 5389).
pub fn is_stun(buf: &[u8]) -> bool {
    buf.len() >= HEADER_LEN && buf[0] < 2 && buf[4..8] == MAGIC_COOKIE
}

/// The local half of the USERNAME of a STUN message: the ufrag of the agent
/// the message is addressed to.
///
/// A check sent to us carries `<our ufrag>:<their ufrag>`. Returns `None` for
/// anything that is not a well formed STUN message with a USERNAME.
pub fn local_ufrag(buf: &[u8]) -> Option<&str> {
    if !is_stun(buf) {
        return None;
    }

    let declared = u16::from_be_bytes([buf[2], buf[3]]) as usize;
    let end = HEADER_LEN.checked_add(declared)?;
    let body = buf.get(HEADER_LEN..end)?;

    let mut rest = body;
    while rest.len() >= 4 {
        let kind = u16::from_be_bytes([rest[0], rest[1]]);
        let len = u16::from_be_bytes([rest[2], rest[3]]) as usize;
        let value = rest.get(4..4 + len)?;

        if kind == ATTRIBUTE_USERNAME {
            let username = std::str::from_utf8(value).ok()?;
            let (local, _) = username.split_once(':')?;
            return (!local.is_empty()).then_some(local);
        }

        // Attribute values are padded to a multiple of four bytes.
        let padded = (len + 3) & !3;
        rest = rest.get(4 + padded..)?;
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn message(attributes: &[(u16, &[u8])]) -> Vec<u8> {
        let mut body = Vec::new();
        for (kind, value) in attributes {
            body.extend_from_slice(&kind.to_be_bytes());
            body.extend_from_slice(&(value.len() as u16).to_be_bytes());
            body.extend_from_slice(value);
            while body.len() % 4 != 0 {
                body.push(0);
            }
        }

        let mut buf = vec![0x00, 0x01];
        buf.extend_from_slice(&(body.len() as u16).to_be_bytes());
        buf.extend_from_slice(&MAGIC_COOKIE);
        buf.extend_from_slice(&[7; 12]);
        buf.extend_from_slice(&body);
        buf
    }

    #[test]
    fn reads_the_local_ufrag_of_a_binding_request() {
        let buf = message(&[
            (0x0024, &[0, 0, 0, 1]),
            (ATTRIBUTE_USERNAME, b"serverUfrag:browserUfrag"),
            (0x0008, &[0; 20]),
        ]);

        assert!(is_stun(&buf));
        assert_eq!(local_ufrag(&buf), Some("serverUfrag"));
    }

    #[test]
    fn skips_padded_attributes_before_the_username() {
        let buf = message(&[(0x8022, b"abc"), (ATTRIBUTE_USERNAME, b"a:b")]);

        assert_eq!(local_ufrag(&buf), Some("a"));
    }

    #[test]
    fn rejects_what_is_not_a_usable_username() {
        assert_eq!(local_ufrag(&[]), None);
        assert_eq!(local_ufrag(&[0x80; 40]), None);
        assert_eq!(local_ufrag(&message(&[])), None);
        assert_eq!(
            local_ufrag(&message(&[(ATTRIBUTE_USERNAME, b"nocolon")])),
            None
        );
        assert_eq!(
            local_ufrag(&message(&[(ATTRIBUTE_USERNAME, b":remote")])),
            None
        );
        assert_eq!(
            local_ufrag(&message(&[(ATTRIBUTE_USERNAME, &[0xff, b':', 1])])),
            None
        );

        // A declared length that runs past the end of the datagram.
        let mut truncated = message(&[(ATTRIBUTE_USERNAME, b"a:b")]);
        truncated[3] = 200;
        assert_eq!(local_ufrag(&truncated), None);

        // An attribute that claims more bytes than the message holds.
        let mut overlong = message(&[(ATTRIBUTE_USERNAME, b"a:b")]);
        overlong[HEADER_LEN + 3] = 90;
        assert_eq!(local_ufrag(&overlong), None);
    }
}
