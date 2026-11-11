//! The shell around the core: the UDP socket, the clock, the control API and
//! the life of the process.

use std::fmt;
use std::future::Future;
use std::io;
use std::net::{SocketAddr, SocketAddrV4};
use std::time::{Duration, Instant};

use tokio::net::{TcpListener, UdpSocket};
use tokio::sync::{mpsc, watch};
use tokio::task::JoinHandle;
use tracing::{debug, error, info};

use crate::config::{Config, ConfigError, primary_ipv4};
use crate::core::{Core, CoreConfig, random_id};
use crate::http::{self, AppState, Job};

/// How many datagrams are read in one go before the loop looks at anything
/// else.
const RECV_BATCH: usize = 64;

/// The longest the loop sleeps when the core asks for nothing sooner.
const IDLE_WAKE: Duration = Duration::from_secs(1);

#[derive(Debug)]
pub enum ServerError {
    Config(ConfigError),
    Bind {
        what: &'static str,
        addr: SocketAddr,
        source: io::Error,
    },
    Http(io::Error),
    MediaPlane(String),
}

impl fmt::Display for ServerError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ServerError::Config(e) => write!(f, "{e}"),
            ServerError::Bind { what, addr, source } => {
                write!(f, "cannot bind the {what} on {addr}: {source}")
            }
            ServerError::Http(e) => write!(f, "the control API failed: {e}"),
            ServerError::MediaPlane(e) => write!(f, "the media plane failed: {e}"),
        }
    }
}

impl std::error::Error for ServerError {}

/// A media server that is running.
pub struct Server {
    control_addr: SocketAddr,
    media_addr: SocketAddr,
    candidates: Vec<SocketAddr>,
    epoch: String,
    stop: watch::Sender<bool>,
    media: JoinHandle<()>,
    http: JoinHandle<io::Result<()>>,
}

impl Server {
    pub fn control_addr(&self) -> SocketAddr {
        self.control_addr
    }

    pub fn media_addr(&self) -> SocketAddr {
        self.media_addr
    }

    pub fn candidates(&self) -> &[SocketAddr] {
        &self.candidates
    }

    pub fn epoch(&self) -> &str {
        &self.epoch
    }

    /// Stops both halves and waits for them.
    pub async fn shutdown(self) -> Result<(), ServerError> {
        let _ = self.stop.send(true);
        let media = self.media.await;
        let http = self.http.await;
        outcome(media, http)
    }

    /// Runs until `signal` resolves or either half fails.
    pub async fn run_until(self, signal: impl Future<Output = ()>) -> Result<(), ServerError> {
        let Server {
            stop,
            mut media,
            mut http,
            ..
        } = self;

        let (media, http) = tokio::select! {
            _ = signal => {
                info!("stopping");
                let _ = stop.send(true);
                (media.await, http.await)
            }
            m = &mut media => {
                let _ = stop.send(true);
                (m, http.await)
            }
            h = &mut http => {
                let _ = stop.send(true);
                (media.await, h)
            }
        };
        outcome(media, http)
    }
}

type Joined<T> = Result<T, tokio::task::JoinError>;

fn outcome(media: Joined<()>, http: Joined<io::Result<()>>) -> Result<(), ServerError> {
    match media {
        Ok(()) => {}
        Err(e) if e.is_panic() => {
            return Err(ServerError::MediaPlane("the media task panicked".into()));
        }
        Err(e) => return Err(ServerError::MediaPlane(e.to_string())),
    }
    match http {
        Ok(Ok(())) => Ok(()),
        Ok(Err(e)) => Err(ServerError::Http(e)),
        Err(e) => Err(ServerError::Http(io::Error::other(e.to_string()))),
    }
}

/// Binds both sockets and starts serving.
pub async fn start(config: Config) -> Result<Server, ServerError> {
    config.validate().map_err(ServerError::Config)?;

    let media_bind = SocketAddr::V4(config.media_bind);
    let socket = UdpSocket::bind(media_bind)
        .await
        .map_err(|source| ServerError::Bind {
            what: "media socket",
            addr: media_bind,
            source,
        })?;
    let media_addr = socket.local_addr().map_err(|source| ServerError::Bind {
        what: "media socket",
        addr: media_bind,
        source,
    })?;
    let bound = match media_addr {
        SocketAddr::V4(v4) => v4,
        SocketAddr::V6(_) => SocketAddrV4::new(*config.media_bind.ip(), media_addr.port()),
    };
    let candidates = config
        .candidates(bound, primary_ipv4)
        .map_err(ServerError::Config)?;

    let listener = TcpListener::bind(config.control_bind)
        .await
        .map_err(|source| ServerError::Bind {
            what: "control API",
            addr: config.control_bind,
            source,
        })?;
    let control_addr = listener.local_addr().map_err(|source| ServerError::Bind {
        what: "control API",
        addr: config.control_bind,
        source,
    })?;

    let epoch = random_id();
    let core = Core::new(
        CoreConfig {
            candidates: candidates.clone(),
        },
        epoch.clone(),
    );

    let (jobs_tx, jobs_rx) = mpsc::channel::<Job>(1024);
    let (seq_tx, seq_rx) = watch::channel(0u64);
    let (stop_tx, stop_rx) = watch::channel(false);

    let media = tokio::spawn(media_loop(core, socket, jobs_rx, seq_tx, stop_rx.clone()));

    let app = http::router(AppState::new(jobs_tx, seq_rx, &config.control_secret));
    let mut http_stop = stop_rx;
    let http = tokio::spawn(async move {
        axum::serve(listener, app)
            .with_graceful_shutdown(async move {
                let _ = http_stop.wait_for(|stop| *stop).await;
            })
            .await
    });

    info!(
        control = %control_addr,
        media = %media_addr,
        candidates = ?candidates,
        epoch = %epoch,
        "stellarr-media is running"
    );

    Ok(Server {
        control_addr,
        media_addr,
        candidates,
        epoch,
        stop: stop_tx,
        media,
        http,
    })
}

/// Starts the media server and runs it until `signal`.
pub async fn run(config: Config, signal: impl Future<Output = ()>) -> Result<(), ServerError> {
    start(config).await?.run_until(signal).await
}

/// The one task that owns the core and with it every `Rtc`.
async fn media_loop(
    mut core: Core,
    socket: UdpSocket,
    mut jobs: mpsc::Receiver<Job>,
    seq: watch::Sender<u64>,
    mut stop: watch::Receiver<bool>,
) {
    let mut buf = vec![0u8; 2048];

    loop {
        let now = Instant::now();
        if core.poll_timeout().is_some_and(|t| t <= now) {
            core.handle_timeout(now);
        }

        for out in core.take_outgoing() {
            if let Err(e) = socket.send_to(&out.contents, out.destination).await {
                debug!(error = %e, destination = %out.destination, "a datagram could not be sent");
            }
        }

        let last = core.last_seq();
        seq.send_if_modified(|current| {
            let changed = *current != last;
            *current = last;
            changed
        });

        let wake = core
            .poll_timeout()
            .map_or(now + IDLE_WAKE, |t| t.min(now + IDLE_WAKE));

        tokio::select! {
            _ = stop.wait_for(|stop| *stop) => break,
            job = jobs.recv() => match job {
                Some(job) => job(&mut core, Instant::now()),
                None => break,
            },
            received = socket.recv_from(&mut buf) => {
                match received {
                    Ok((n, source)) => core.handle_datagram(Instant::now(), source, &buf[..n]),
                    Err(e) => debug!(error = %e, "receiving failed"),
                }
                for _ in 0..RECV_BATCH {
                    match socket.try_recv_from(&mut buf) {
                        Ok((n, source)) => core.handle_datagram(Instant::now(), source, &buf[..n]),
                        Err(_) => break,
                    }
                }
            }
            _ = tokio::time::sleep_until(wake.into()) => core.handle_timeout(Instant::now()),
        }
    }

    // A clean stop says goodbye to every browser that is still connected.
    core.reset(Instant::now());
    for out in core.take_outgoing() {
        let _ = socket.try_send_to(&out.contents, out.destination);
    }
    if !*stop.borrow() {
        error!("the media loop ended unexpectedly");
    }
}
