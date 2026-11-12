//! Stellarr Media: the selective forwarding unit of Stellarr.
//!
//! [`core`] is the media server itself, free of sockets and clocks.
//! [`server`] runs it on a UDP socket and serves the control API of
//! [`http`] next to it. See `docs/stellarr-media.md`.

pub mod config;
pub mod core;
pub mod events;
pub mod http;
pub mod sdp_text;
pub mod server;
pub mod stun;
