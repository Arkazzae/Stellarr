//! The `stellarr-media` binary: configuration from the environment, logging,
//! signals and the exit status.

use std::io::IsTerminal;
use std::process::ExitCode;

use stellarr_media::config::Config;
use stellarr_media::server;
use tracing::error;
use tracing_subscriber::EnvFilter;

fn main() -> ExitCode {
    let config = match Config::from_lookup(|name| std::env::var(name).ok()) {
        Ok(config) => config,
        Err(e) => {
            eprintln!("stellarr-media: {e}");
            return ExitCode::FAILURE;
        }
    };

    let filter = EnvFilter::try_new(&config.log).unwrap_or_else(|_| {
        eprintln!(
            "stellarr-media: STELLARR_MEDIA_LOG {:?} is not a valid filter, using info",
            config.log
        );
        EnvFilter::new("info")
    });
    // Under supervisord the log is a file, where colour codes are noise.
    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_ansi(std::io::stdout().is_terminal())
        .init();

    let runtime = match tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(e) => {
            error!(error = %e, "cannot start the runtime");
            return ExitCode::FAILURE;
        }
    };

    // A failure to bind exits with a non-zero status, so supervisord starts
    // the process again and the API sees a new epoch.
    match runtime.block_on(server::run(config, shutdown_signal())) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            error!(error = %e, "stellarr-media stopped");
            ExitCode::FAILURE
        }
    }
}

/// Resolves on SIGTERM or SIGINT.
async fn shutdown_signal() {
    let interrupt = tokio::signal::ctrl_c();

    #[cfg(unix)]
    {
        use tokio::signal::unix::{SignalKind, signal};
        match signal(SignalKind::terminate()) {
            Ok(mut terminate) => {
                tokio::select! {
                    _ = interrupt => {}
                    _ = terminate.recv() => {}
                }
            }
            Err(_) => {
                let _ = interrupt.await;
            }
        }
    }

    #[cfg(not(unix))]
    {
        let _ = interrupt.await;
    }
}
