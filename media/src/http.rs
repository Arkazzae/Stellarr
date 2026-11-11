//! The control API: JSON over HTTP/1.1 for `AppHub`, its only client.
//!
//! Handlers never touch an `Rtc`. Each one sends a job to the task that owns
//! the core and awaits the reply, so every session is only ever mutated from
//! that one task.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::Router;
use axum::body::Bytes;
use axum::extract::rejection::BytesRejection;
use axum::extract::{DefaultBodyLimit, Path, Query, Request, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use serde::Serialize;
use serde_json::{Value, json};
use tokio::sync::{mpsc, oneshot, watch};

use crate::core::{ApiError, Core};

/// The largest request body the control API reads.
pub const MAX_BODY_BYTES: usize = 256 * 1024;

/// The longest a poll of the event log may wait.
pub const MAX_WAIT: Duration = Duration::from_millis(30_000);

/// A piece of work for the task that owns the core.
pub type Job = Box<dyn FnOnce(&mut Core, Instant) + Send>;

#[derive(Clone)]
pub struct AppState {
    jobs: mpsc::Sender<Job>,
    seq: watch::Receiver<u64>,
    secret: Arc<[u8]>,
}

impl AppState {
    /// `seq` follows the newest sequence number of the event log, so a long
    /// poll wakes when there is something to read.
    pub fn new(jobs: mpsc::Sender<Job>, seq: watch::Receiver<u64>, secret: &str) -> AppState {
        AppState {
            jobs,
            seq,
            secret: Arc::from(secret.as_bytes()),
        }
    }
}

pub fn router(state: AppState) -> Router {
    let protected = Router::new()
        .route("/v1/reset", post(reset))
        .route("/v1/sessions", post(create_session))
        .route("/v1/sessions/{id}", delete(delete_session))
        .route("/v1/sessions/{id}/offer", post(offer))
        .route("/v1/sessions/{id}/answer", post(answer))
        .route("/v1/sessions/{id}/candidate", post(candidate))
        .route("/v1/events", get(events))
        .route("/v1/stats", get(stats))
        .route_layer(middleware::from_fn_with_state(state.clone(), authorize));

    Router::new()
        .route("/v1/health", get(health))
        .merge(protected)
        .fallback(not_found)
        .method_not_allowed_fallback(method_not_allowed)
        .layer(DefaultBodyLimit::max(MAX_BODY_BYTES))
        .with_state(state)
}

fn error(status: StatusCode, code: &str, detail: impl Into<String>) -> Response {
    let body = json!({ "error": code, "detail": detail.into() });
    (status, axum::Json(body)).into_response()
}

fn api_error(e: ApiError) -> Response {
    let status = match e {
        ApiError::UnknownSession => StatusCode::NOT_FOUND,
        ApiError::StaleNegotiation => StatusCode::CONFLICT,
        ApiError::InvalidRequest(_)
        | ApiError::InvalidSdp(_)
        | ApiError::LimitExceeded(_)
        | ApiError::InvalidCandidate(_) => StatusCode::UNPROCESSABLE_ENTITY,
    };
    error(status, e.code(), e.detail())
}

fn ok(status: StatusCode, body: impl Serialize) -> Response {
    (status, axum::Json(body)).into_response()
}

fn unavailable() -> Response {
    error(
        StatusCode::SERVICE_UNAVAILABLE,
        "unavailable",
        "The media plane is not running.",
    )
}

/// The task that owns the core is gone, so no request can be served.
struct Unavailable;

/// Runs `f` on the task that owns the core and returns what it returned.
async fn call<T: Send + 'static>(
    state: &AppState,
    f: impl FnOnce(&mut Core, Instant) -> T + Send + 'static,
) -> Result<T, Unavailable> {
    let (reply, rx) = oneshot::channel();
    let job: Job = Box::new(move |core, now| {
        let _ = reply.send(f(core, now));
    });
    state.jobs.send(job).await.map_err(|_| Unavailable)?;
    rx.await.map_err(|_| Unavailable)
}

/// Compares the presented secret with the configured one in time that
/// depends only on the configured secret, not on how much of it matched.
fn secret_matches(presented: &[u8], secret: &[u8]) -> bool {
    let mut diff = u8::from(presented.len() != secret.len());
    for (i, s) in secret.iter().enumerate() {
        let p = presented.get(i).copied().unwrap_or(0);
        diff |= std::hint::black_box(p ^ s);
    }
    diff == 0
}

async fn authorize(
    State(state): State<AppState>,
    headers: HeaderMap,
    request: Request,
    next: Next,
) -> Response {
    // An empty secret is only possible on a loopback address, where the
    // configuration accepted it, and then nothing is asked of the caller.
    if !state.secret.is_empty() {
        let presented = headers
            .get(header::AUTHORIZATION)
            .and_then(|v| v.as_bytes().strip_prefix(b"Bearer "))
            .unwrap_or(&[]);
        if !secret_matches(presented, &state.secret) {
            return error(
                StatusCode::UNAUTHORIZED,
                "unauthorized",
                "A valid bearer secret is required.",
            );
        }
    }
    next.run(request).await
}

/// Why a request body could not be read.
enum BodyError {
    TooLarge,
    Malformed(String),
}

fn too_large() -> Response {
    error(
        StatusCode::PAYLOAD_TOO_LARGE,
        "payload-too-large",
        "The request body is larger than 256 KiB.",
    )
}

fn json_body(body: Result<Bytes, BytesRejection>) -> Result<Value, BodyError> {
    let bytes = body.map_err(|rejection| {
        if rejection.status() == StatusCode::PAYLOAD_TOO_LARGE {
            BodyError::TooLarge
        } else {
            BodyError::Malformed(rejection.body_text())
        }
    })?;
    serde_json::from_slice::<Value>(&bytes)
        .map_err(|e| BodyError::Malformed(format!("The body is not JSON: {e}")))
}

/// The body of a request about one session. An oversized body is refused at
/// once (`None`); a malformed one becomes the route's own error, reported
/// only after the session is known to exist.
fn session_body(
    body: Result<Bytes, BytesRejection>,
    malformed: fn(String) -> ApiError,
) -> Option<Result<Value, ApiError>> {
    match json_body(body) {
        Ok(value) => Some(Ok(value)),
        Err(BodyError::TooLarge) => None,
        Err(BodyError::Malformed(detail)) => Some(Err(malformed(detail))),
    }
}

async fn not_found() -> Response {
    error(StatusCode::NOT_FOUND, "not-found", "No such route.")
}

async fn method_not_allowed() -> Response {
    error(
        StatusCode::METHOD_NOT_ALLOWED,
        "method-not-allowed",
        "The route does not take this method.",
    )
}

async fn health(State(state): State<AppState>) -> Response {
    match call(&state, |core, _| core.health()).await {
        Ok(health) => ok(StatusCode::OK, health),
        Err(Unavailable) => unavailable(),
    }
}

async fn reset(State(state): State<AppState>) -> Response {
    match call(&state, |core, now| core.reset(now)).await {
        Ok(reply) => ok(StatusCode::OK, reply),
        Err(Unavailable) => unavailable(),
    }
}

async fn create_session(
    State(state): State<AppState>,
    body: Result<Bytes, BytesRejection>,
) -> Response {
    let body = match json_body(body) {
        Ok(b) => b,
        Err(BodyError::TooLarge) => return too_large(),
        Err(BodyError::Malformed(detail)) => return api_error(ApiError::InvalidRequest(detail)),
    };
    let (Some(room_id), Some(user_id)) = (
        body.get("roomId")
            .and_then(Value::as_str)
            .map(str::to_string),
        body.get("userId")
            .and_then(Value::as_str)
            .map(str::to_string),
    ) else {
        return api_error(ApiError::InvalidRequest(
            "roomId and userId are required strings.".into(),
        ));
    };

    match call(&state, move |core, now| {
        core.create_session(now, &room_id, &user_id)
    })
    .await
    {
        Ok(Ok(created)) => ok(StatusCode::CREATED, created),
        Ok(Err(e)) => api_error(e),
        Err(Unavailable) => unavailable(),
    }
}

async fn delete_session(State(state): State<AppState>, Path(id): Path<String>) -> Response {
    match call(&state, move |core, now| core.delete_session(now, &id)).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(Unavailable) => unavailable(),
    }
}

/// Runs a session request whose body may be malformed. An unknown session is
/// reported first: the API treats that answer specially, whatever the body.
async fn session_call(
    state: &AppState,
    id: String,
    body: Result<Value, ApiError>,
    f: impl FnOnce(&mut Core, Instant, &str, Value) -> Result<(), ApiError> + Send + 'static,
) -> Response {
    let result = call(state, move |core, now| {
        if !core.has_session(&id) {
            return Err(ApiError::UnknownSession);
        }
        f(core, now, &id, body?)
    })
    .await;

    match result {
        Ok(Ok(())) => StatusCode::NO_CONTENT.into_response(),
        Ok(Err(e)) => api_error(e),
        Err(Unavailable) => unavailable(),
    }
}

async fn offer(
    State(state): State<AppState>,
    Path(id): Path<String>,
    body: Result<Bytes, BytesRejection>,
) -> Response {
    let Some(body) = session_body(body, ApiError::InvalidSdp) else {
        return too_large();
    };
    session_call(&state, id, body, |core, now, id, body| {
        let Some(sdp) = body.get("sdp").and_then(Value::as_str) else {
            return Err(ApiError::InvalidSdp("sdp is a required string.".into()));
        };
        core.offer(now, id, sdp)
    })
    .await
}

async fn answer(
    State(state): State<AppState>,
    Path(id): Path<String>,
    body: Result<Bytes, BytesRejection>,
) -> Response {
    let Some(body) = session_body(body, ApiError::InvalidSdp) else {
        return too_large();
    };
    session_call(&state, id, body, |core, now, id, body| {
        let (Some(sdp), Some(negotiation_id)) = (
            body.get("sdp").and_then(Value::as_str),
            body.get("negotiationId").and_then(Value::as_u64),
        ) else {
            return Err(ApiError::InvalidSdp(
                "sdp is a required string and negotiationId a required number.".into(),
            ));
        };
        core.answer(now, id, sdp, negotiation_id)
    })
    .await
}

async fn candidate(
    State(state): State<AppState>,
    Path(id): Path<String>,
    body: Result<Bytes, BytesRejection>,
) -> Response {
    let Some(body) = session_body(body, ApiError::InvalidCandidate) else {
        return too_large();
    };
    session_call(&state, id, body, |core, now, id, body| {
        match body.get("candidate") {
            Some(Value::Null) => core.candidate(now, id, None),
            Some(c @ Value::Object(_)) => core.candidate(now, id, Some(c)),
            _ => Err(ApiError::InvalidCandidate(
                "candidate must be an object or null.".into(),
            )),
        }
    })
    .await
}

fn query_number(query: &HashMap<String, String>, name: &str) -> Result<u64, ApiError> {
    match query.get(name) {
        None => Ok(0),
        Some(v) => v.parse::<u64>().map_err(|_| {
            ApiError::InvalidRequest(format!("{name} must be a non-negative integer."))
        }),
    }
}

async fn events(
    State(state): State<AppState>,
    query: Result<Query<HashMap<String, String>>, axum::extract::rejection::QueryRejection>,
) -> Response {
    let Ok(Query(query)) = query else {
        return api_error(ApiError::InvalidRequest(
            "The query string is malformed.".into(),
        ));
    };
    let epoch = query.get("epoch").cloned();
    let after = match query_number(&query, "after") {
        Ok(v) => v,
        Err(e) => return api_error(e),
    };
    let wait = match query_number(&query, "waitMs") {
        Ok(v) => Duration::from_millis(v).min(MAX_WAIT),
        Err(e) => return api_error(e),
    };

    let deadline = tokio::time::Instant::now() + wait;
    let mut seq = state.seq.clone();
    loop {
        // Marked seen before reading, so an event issued between the read and
        // the wait still wakes the wait.
        seq.borrow_and_update();
        let epoch = epoch.clone();
        let poll = match call(&state, move |core, _| core.events(epoch.as_deref(), after)).await {
            Ok(poll) => poll,
            Err(Unavailable) => return unavailable(),
        };
        if poll.reset || !poll.events.is_empty() {
            return ok(StatusCode::OK, poll);
        }

        tokio::select! {
            changed = seq.changed() => {
                if changed.is_err() {
                    return ok(StatusCode::OK, poll);
                }
            }
            _ = tokio::time::sleep_until(deadline) => return ok(StatusCode::OK, poll),
        }
    }
}

async fn stats(State(state): State<AppState>) -> Response {
    match call(&state, |core, now| core.stats(now)).await {
        Ok(stats) => ok(StatusCode::OK, stats),
        Err(Unavailable) => unavailable(),
    }
}

#[cfg(test)]
mod tests {
    use super::secret_matches;

    #[test]
    fn compares_secrets_exactly() {
        assert!(secret_matches(b"s3cret", b"s3cret"));
        assert!(!secret_matches(b"s3cres", b"s3cret"));
        assert!(!secret_matches(b"s3cre", b"s3cret"));
        assert!(!secret_matches(b"s3crett", b"s3cret"));
        assert!(!secret_matches(b"", b"s3cret"));
        assert!(!secret_matches(b"s3cret\0", b"s3cret"));
    }
}
