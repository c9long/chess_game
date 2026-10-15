//! `bot-service` binary: reads the environment, serves until SIGINT/SIGTERM.

use bot_service::{AppState, Config, LogFormat, serve};
use tracing_subscriber::EnvFilter;

fn main() -> std::process::ExitCode {
    let config = match Config::from_env() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("bot-service: {e}");
            return std::process::ExitCode::from(2);
        }
    };
    let filter = EnvFilter::try_new(&config.log_filter).unwrap_or_else(|_| EnvFilter::new("info"));
    // Colors only on a terminal, not in files or container logs.
    let ansi = std::io::IsTerminal::is_terminal(&std::io::stdout());
    let fmt = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_ansi(ansi);
    match config.log_format {
        LogFormat::Json => fmt.json().init(),
        LogFormat::Text => fmt.init(),
    }
    // A small async runtime: request parsing is cheap, searches run on the
    // dedicated worker threads.
    let rt = match tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
    {
        Ok(rt) => rt,
        Err(e) => {
            tracing::error!(error = %e, "cannot start runtime");
            return std::process::ExitCode::FAILURE;
        }
    };
    match rt.block_on(run(config)) {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(e) => {
            tracing::error!(error = %e, "server failed");
            std::process::ExitCode::FAILURE
        }
    }
}

async fn run(config: Config) -> std::io::Result<()> {
    let listener = bot_service::bind(config.bind)?;
    tracing::info!(
        bind = %listener.local_addr()?,
        workers = config.workers,
        max_queue = config.max_queue,
        "bot-service listening"
    );
    let app = AppState::new(config);
    serve(listener, app, shutdown_signal()).await?;
    tracing::info!("bot-service stopped");
    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let term = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut s) => {
                s.recv().await;
            }
            Err(_) => std::future::pending::<()>().await,
        }
    };
    #[cfg(not(unix))]
    let term = std::future::pending::<()>();
    tokio::select! {
        () = ctrl_c => {},
        () = term => {},
    }
    tracing::info!("shutdown requested; finishing open requests");
}
