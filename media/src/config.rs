//! Configuration from the environment, as `docs/STELLARR_MEDIA.md` lists it.

use std::fmt;
use std::net::{IpAddr, Ipv4Addr, SocketAddr, SocketAddrV4, UdpSocket};

pub const DEFAULT_MEDIA_BIND: SocketAddrV4 = SocketAddrV4::new(Ipv4Addr::UNSPECIFIED, 49000);
pub const DEFAULT_CONTROL_BIND: SocketAddr = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 5200);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConfigError(pub String);

impl fmt::Display for ConfigError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for ConfigError {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Config {
    /// The UDP socket every session shares.
    pub media_bind: SocketAddrV4,
    pub public_ip: Option<Ipv4Addr>,
    pub public_port: Option<u16>,
    /// When set, the candidates exactly as listed, in this order.
    pub advertise: Option<Vec<SocketAddrV4>>,
    pub control_bind: SocketAddr,
    pub control_secret: String,
    /// A `tracing` filter directive, `info` by default.
    pub log: String,
}

impl Config {
    /// Reads the configuration through `lookup`, which is `std::env::var` in
    /// the binary. An empty variable counts as unset.
    pub fn from_lookup(lookup: impl Fn(&str) -> Option<String>) -> Result<Config, ConfigError> {
        let var = |name: &str| {
            lookup(name)
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty())
        };

        let media_bind = match var("STELLARR_MEDIA_BIND") {
            Some(v) => v.parse::<SocketAddrV4>().map_err(|_| {
                ConfigError(format!(
                    "STELLARR_MEDIA_BIND must be an IPv4 ip:port, got {v:?}"
                ))
            })?,
            None => DEFAULT_MEDIA_BIND,
        };

        let public_ip = match var("STELLARR_MEDIA_PUBLIC_IP") {
            Some(v) => {
                let ip = v.parse::<Ipv4Addr>().map_err(|_| {
                    ConfigError(format!(
                        "STELLARR_MEDIA_PUBLIC_IP must be an IPv4 address, got {v:?}"
                    ))
                })?;
                Some(ip)
            }
            None => None,
        };

        let public_port = match var("STELLARR_MEDIA_PUBLIC_PORT") {
            Some(v) => match v.parse::<u16>() {
                Ok(p) if p != 0 => Some(p),
                _ => {
                    return Err(ConfigError(format!(
                        "STELLARR_MEDIA_PUBLIC_PORT must be a port number, got {v:?}"
                    )));
                }
            },
            None => None,
        };

        let advertise = match var("STELLARR_MEDIA_ADVERTISE") {
            Some(v) => {
                let mut list = Vec::new();
                for item in v.split(',').map(str::trim).filter(|i| !i.is_empty()) {
                    let addr = item.parse::<SocketAddrV4>().map_err(|_| {
                        ConfigError(format!(
                            "STELLARR_MEDIA_ADVERTISE entries must be IPv4 ip:port, got {item:?}"
                        ))
                    })?;
                    list.push(addr);
                }
                if list.is_empty() {
                    return Err(ConfigError(
                        "STELLARR_MEDIA_ADVERTISE lists no address".into(),
                    ));
                }
                Some(list)
            }
            None => None,
        };

        let control_bind = match var("STELLARR_MEDIA_CONTROL_BIND") {
            Some(v) => v.parse::<SocketAddr>().map_err(|_| {
                ConfigError(format!(
                    "STELLARR_MEDIA_CONTROL_BIND must be ip:port, got {v:?}"
                ))
            })?,
            None => DEFAULT_CONTROL_BIND,
        };

        // HTTP drops whitespace around a header value, so a secret that began
        // or ended with some could never be presented intact. It is trimmed,
        // as the API trims its copy, and then compared byte for byte.
        let control_secret = var("STELLARR_MEDIA_CONTROL_SECRET").unwrap_or_default();

        let config = Config {
            media_bind,
            public_ip,
            public_port,
            advertise,
            control_bind,
            control_secret,
            log: var("STELLARR_MEDIA_LOG").unwrap_or_else(|| "info".into()),
        };
        config.validate()?;
        Ok(config)
    }

    /// Refuses configurations the process must not start with.
    pub fn validate(&self) -> Result<(), ConfigError> {
        // Without a secret anyone who reaches the control API can open
        // sessions and read every signal, so that is only acceptable when
        // nothing outside the machine can reach it.
        if self.control_secret.is_empty() && !self.control_bind.ip().is_loopback() {
            return Err(ConfigError(format!(
                "STELLARR_MEDIA_CONTROL_SECRET is empty but the control API would listen on {}; \
                 an empty secret is only accepted on a loopback address",
                self.control_bind
            )));
        }

        if let Some(ip) = self.public_ip {
            check_candidate_ip(ip, "STELLARR_MEDIA_PUBLIC_IP")?;
        }
        for addr in self.advertise.iter().flatten() {
            check_candidate_ip(*addr.ip(), "STELLARR_MEDIA_ADVERTISE")?;
            if addr.port() == 0 {
                return Err(ConfigError(
                    "STELLARR_MEDIA_ADVERTISE entries need a port".into(),
                ));
            }
        }

        Ok(())
    }

    /// The host candidates every session advertises, in order.
    ///
    /// `bound` is the socket as actually bound, which matters when the port
    /// was 0. `local_ip` finds the primary IPv4 address of the machine when
    /// the socket is bound to all of them.
    pub fn candidates(
        &self,
        bound: SocketAddrV4,
        local_ip: impl FnOnce() -> Option<Ipv4Addr>,
    ) -> Result<Vec<SocketAddr>, ConfigError> {
        if let Some(list) = &self.advertise {
            return Ok(list.iter().map(|a| SocketAddr::V4(*a)).collect());
        }

        let mut out = Vec::new();

        if let Some(ip) = self.public_ip {
            let port = self.public_port.unwrap_or(bound.port());
            out.push(SocketAddr::V4(SocketAddrV4::new(ip, port)));
        }

        let local = if bound.ip().is_unspecified() {
            local_ip().unwrap_or(Ipv4Addr::LOCALHOST)
        } else {
            *bound.ip()
        };
        check_candidate_ip(local, "the local IPv4 address")?;

        let local = SocketAddr::V4(SocketAddrV4::new(local, bound.port()));
        if !out.contains(&local) {
            out.push(local);
        }

        Ok(out)
    }
}

fn check_candidate_ip(ip: Ipv4Addr, what: &str) -> Result<(), ConfigError> {
    if ip.is_unspecified() || ip.is_broadcast() || ip.is_multicast() || ip.is_link_local() {
        return Err(ConfigError(format!(
            "{what} {ip} cannot be advertised as a candidate"
        )));
    }
    Ok(())
}

/// The IPv4 address the machine would use to reach the internet.
///
/// Connecting a UDP socket sends nothing; it only asks the routing table which
/// source address it would pick. The destination is a documentation address
/// (TEST-NET-1), so the answer is the address of the default route.
pub fn primary_ipv4() -> Option<Ipv4Addr> {
    let socket = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)).ok()?;
    socket.connect((Ipv4Addr::new(192, 0, 2, 1), 9)).ok()?;
    match socket.local_addr().ok()?.ip() {
        IpAddr::V4(ip) if !ip.is_unspecified() => Some(ip),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;

    fn config(vars: &[(&str, &str)]) -> Result<Config, ConfigError> {
        let vars: HashMap<String, String> = vars
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        Config::from_lookup(|name| vars.get(name).cloned())
    }

    fn bound(addr: &str) -> SocketAddrV4 {
        addr.parse().unwrap()
    }

    #[test]
    fn defaults_follow_the_contract() {
        let c = config(&[]).unwrap();

        assert_eq!(c.media_bind, bound("0.0.0.0:49000"));
        assert_eq!(c.control_bind, "127.0.0.1:5200".parse().unwrap());
        assert_eq!(c.control_secret, "");
        assert_eq!(c.log, "info");
        assert_eq!(c.public_ip, None);
        assert_eq!(c.advertise, None);
    }

    #[test]
    fn refuses_an_empty_secret_off_loopback() {
        let err = config(&[("STELLARR_MEDIA_CONTROL_BIND", "0.0.0.0:5200")]).unwrap_err();
        assert!(err.0.contains("STELLARR_MEDIA_CONTROL_SECRET"));

        assert!(config(&[("STELLARR_MEDIA_CONTROL_BIND", "10.0.0.5:5200")]).is_err());
        assert!(config(&[("STELLARR_MEDIA_CONTROL_BIND", "127.0.0.2:5200")]).is_ok());
        assert!(config(&[("STELLARR_MEDIA_CONTROL_BIND", "[::1]:5200")]).is_ok());
        assert!(
            config(&[
                ("STELLARR_MEDIA_CONTROL_BIND", "0.0.0.0:5200"),
                ("STELLARR_MEDIA_CONTROL_SECRET", "s3cret"),
            ])
            .is_ok()
        );
    }

    #[test]
    fn advertises_the_public_address_first_then_the_local_one() {
        let c = config(&[("STELLARR_MEDIA_PUBLIC_IP", "203.0.113.7")]).unwrap();
        let list = c
            .candidates(bound("0.0.0.0:49000"), || {
                Some(Ipv4Addr::new(172, 18, 0, 2))
            })
            .unwrap();

        assert_eq!(
            list,
            [
                "203.0.113.7:49000".parse().unwrap(),
                "172.18.0.2:49000".parse().unwrap()
            ]
        );
    }

    #[test]
    fn advertises_the_public_port_with_the_public_address_only() {
        let c = config(&[
            ("STELLARR_MEDIA_PUBLIC_IP", "203.0.113.7"),
            ("STELLARR_MEDIA_PUBLIC_PORT", "50000"),
        ])
        .unwrap();
        let list = c.candidates(bound("172.18.0.2:49000"), || None).unwrap();

        assert_eq!(
            list,
            [
                "203.0.113.7:50000".parse().unwrap(),
                "172.18.0.2:49000".parse().unwrap()
            ]
        );
    }

    #[test]
    fn advertises_one_local_address_without_a_public_one() {
        let c = config(&[]).unwrap();

        let list = c
            .candidates(bound("0.0.0.0:41234"), || {
                Some(Ipv4Addr::new(192, 168, 1, 4))
            })
            .unwrap();
        assert_eq!(list, ["192.168.1.4:41234".parse().unwrap()]);

        let list = c.candidates(bound("0.0.0.0:41234"), || None).unwrap();
        assert_eq!(list, ["127.0.0.1:41234".parse().unwrap()]);
    }

    #[test]
    fn an_explicit_list_replaces_the_derived_one() {
        let c = config(&[
            ("STELLARR_MEDIA_PUBLIC_IP", "203.0.113.7"),
            (
                "STELLARR_MEDIA_ADVERTISE",
                "198.51.100.1:49000, 10.0.0.2:49001",
            ),
        ])
        .unwrap();
        let list = c.candidates(bound("0.0.0.0:49000"), || None).unwrap();

        assert_eq!(
            list,
            [
                "198.51.100.1:49000".parse().unwrap(),
                "10.0.0.2:49001".parse().unwrap()
            ]
        );
    }

    #[test]
    fn rejects_malformed_values() {
        assert!(config(&[("STELLARR_MEDIA_BIND", "[::]:49000")]).is_err());
        assert!(config(&[("STELLARR_MEDIA_BIND", "49000")]).is_err());
        assert!(config(&[("STELLARR_MEDIA_PUBLIC_IP", "chat.example.com")]).is_err());
        assert!(config(&[("STELLARR_MEDIA_PUBLIC_IP", "0.0.0.0")]).is_err());
        assert!(config(&[("STELLARR_MEDIA_PUBLIC_PORT", "0")]).is_err());
        assert!(config(&[("STELLARR_MEDIA_ADVERTISE", "1.2.3.4")]).is_err());
        assert!(config(&[("STELLARR_MEDIA_ADVERTISE", "1.2.3.4:0")]).is_err());
        assert!(config(&[("STELLARR_MEDIA_ADVERTISE", " , ")]).is_err());
        assert!(config(&[("STELLARR_MEDIA_CONTROL_BIND", "localhost:5200")]).is_err());
    }

    #[test]
    fn treats_empty_variables_as_unset() {
        let c = config(&[
            ("STELLARR_MEDIA_PUBLIC_IP", ""),
            ("STELLARR_MEDIA_BIND", " "),
        ])
        .unwrap();
        assert_eq!(c.public_ip, None);
        assert_eq!(c.media_bind, DEFAULT_MEDIA_BIND);
    }

    #[test]
    fn trims_the_secret_as_a_header_would() {
        let c = config(&[("STELLARR_MEDIA_CONTROL_SECRET", " s3cret\n")]).unwrap();
        assert_eq!(c.control_secret, "s3cret");

        // Nothing but whitespace is no secret at all, which only loopback takes.
        let err = config(&[
            ("STELLARR_MEDIA_CONTROL_SECRET", "  "),
            ("STELLARR_MEDIA_CONTROL_BIND", "0.0.0.0:5200"),
        ])
        .unwrap_err();
        assert!(err.0.contains("STELLARR_MEDIA_CONTROL_SECRET"));
    }
}
