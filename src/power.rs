//! The Power page's data, relayed from an operator-provided power source.
//!
//! The dashboard cannot read a UPS or a power supply itself: they sit behind
//! apcupsd, NUT, a vendor USB dongle or a time-series database, differently on
//! every machine. So the operator runs (or already has) a small HTTP service
//! that answers the JSON documents described in `docs/power.md` (the power
//! documents, and the GPUs, Tokens and Host pages'), and points `--power-url`
//! at it. This module only relays them to the browser: GET only, ten fixed
//! paths, bounded query parameters, a short timeout and a size cap. The source's address never reaches the browser, so a service on
//! loopback stays on loopback.
//!
//! Without `--power-url` every power route answers 404, which the Power panels
//! render as "no power source configured" rather than as an error.

use std::time::Duration;

use axum::extract::{Query, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use serde::Deserialize;

use crate::server::AppState;

/// Largest document relayed. A week of five-minute points is ~2,000 rows,
/// well under this; anything bigger is a misbehaving source, not data.
pub const MAX_RESPONSE_BYTES: usize = 1024 * 1024;

/// A power source slower than this is reported as unavailable: the panels
/// poll every few seconds and must not pile requests up behind a stuck one.
const TIMEOUT: Duration = Duration::from_secs(5);

/// Bounds on the history and daily windows a browser may ask for.
const MAX_HISTORY_HOURS: u32 = 168;
const DEFAULT_HISTORY_HOURS: u32 = 24;
const MAX_DAILY_DAYS: u32 = 31;
/// The live strips' window: up to the longest chart window (15 minutes), 5 by default.
const MAX_RECENT_MINUTES: u32 = 15;
const DEFAULT_RECENT_MINUTES: u32 = 5;
const DEFAULT_DAILY_DAYS: u32 = 7;

/// Where the power documents come from.
#[derive(Debug)]
pub struct PowerSource {
    base: reqwest::Url,
    client: reqwest::Client,
}

impl PowerSource {
    /// `base` is the source's root, e.g. `http://127.0.0.1:18031`; the three
    /// documents are read from `<base>/now`, `<base>/history` and `<base>/daily`.
    pub fn new(base: &str) -> Result<Self, String> {
        let mut base =
            reqwest::Url::parse(base).map_err(|e| format!("--power-url {base:?}: {e}"))?;
        if !matches!(base.scheme(), "http" | "https") {
            return Err(format!(
                "--power-url must be http or https, not {}",
                base.scheme()
            ));
        }
        // Join relative to the path as given, with or without a trailing slash.
        if !base.path().ends_with('/') {
            let path = format!("{}/", base.path());
            base.set_path(&path);
        }
        let client = reqwest::Client::builder()
            .timeout(TIMEOUT)
            .build()
            .map_err(|e| format!("power source client: {e}"))?;
        Ok(Self { base, client })
    }

    fn url(&self, document: &str, query: &[(&str, String)]) -> reqwest::Url {
        let mut url = self
            .base
            .join(document)
            .expect("fixed document names always join");
        if !query.is_empty() {
            url.query_pairs_mut()
                .extend_pairs(query.iter().map(|(k, v)| (*k, v.as_str())));
        }
        url
    }

    async fn fetch(&self, url: reqwest::Url) -> Response {
        let mut resp = match self.client.get(url).send().await {
            Ok(resp) => resp,
            Err(err) => {
                tracing::warn!("power source unreachable: {err}");
                return (StatusCode::BAD_GATEWAY, "power source unreachable").into_response();
            }
        };
        if !resp.status().is_success() {
            tracing::warn!("power source answered {}", resp.status());
            return (
                StatusCode::BAD_GATEWAY,
                format!("power source answered {}", resp.status().as_u16()),
            )
                .into_response();
        }
        let mut body = Vec::new();
        loop {
            match resp.chunk().await {
                Ok(Some(chunk)) => {
                    if body.len() + chunk.len() > MAX_RESPONSE_BYTES {
                        tracing::warn!("power source document over {MAX_RESPONSE_BYTES} bytes");
                        return (StatusCode::BAD_GATEWAY, "power source document too large")
                            .into_response();
                    }
                    body.extend_from_slice(&chunk);
                }
                Ok(None) => break,
                Err(err) => {
                    tracing::warn!("power source read failed: {err}");
                    return (StatusCode::BAD_GATEWAY, "power source read failed").into_response();
                }
            }
        }
        // Relayed unparsed: the frontend owns the document's shape (docs/power.md).
        (
            StatusCode::OK,
            [(header::CONTENT_TYPE, "application/json")],
            body,
        )
            .into_response()
    }
}

fn not_configured() -> Response {
    (StatusCode::NOT_FOUND, "no power source configured").into_response()
}

#[derive(Debug, Deserialize)]
pub struct HistoryQuery {
    hours: Option<u32>,
}

#[derive(Debug, Deserialize)]
pub struct DailyQuery {
    days: Option<u32>,
}

#[derive(Debug, Deserialize)]
pub struct RecentQuery {
    minutes: Option<u32>,
}

fn bounded(value: Option<u32>, default: u32, max: u32) -> u32 {
    value.unwrap_or(default).clamp(1, max)
}

pub async fn now(State(state): State<AppState>) -> Response {
    let Some(source) = state.power.as_deref() else {
        return not_configured();
    };
    source.fetch(source.url("now", &[])).await
}

/// The live strips' last few minutes as the source recorded them, so a strip
/// does not depend on a browser having polled `/now` all that time.
pub async fn recent(State(state): State<AppState>, Query(q): Query<RecentQuery>) -> Response {
    let Some(source) = state.power.as_deref() else {
        return not_configured();
    };
    let minutes = bounded(q.minutes, DEFAULT_RECENT_MINUTES, MAX_RECENT_MINUTES);
    source
        .fetch(source.url("recent", &[("minutes", minutes.to_string())]))
        .await
}

pub async fn history(State(state): State<AppState>, Query(q): Query<HistoryQuery>) -> Response {
    let Some(source) = state.power.as_deref() else {
        return not_configured();
    };
    let hours = bounded(q.hours, DEFAULT_HISTORY_HOURS, MAX_HISTORY_HOURS);
    source
        .fetch(source.url("history", &[("hours", hours.to_string())]))
        .await
}

/// The GPUs page's live extras and 24 h health (docs/power.md, "GPU documents"):
/// what NVML's snapshot does not carry, from the same source.
pub async fn gpus(State(state): State<AppState>) -> Response {
    let Some(source) = state.power.as_deref() else {
        return not_configured();
    };
    source.fetch(source.url("gpus", &[])).await
}

/// Each GPU over the last N hours, in the history document's bounds.
pub async fn gpu_history(State(state): State<AppState>, Query(q): Query<HistoryQuery>) -> Response {
    let Some(source) = state.power.as_deref() else {
        return not_configured();
    };
    let hours = bounded(q.hours, DEFAULT_HISTORY_HOURS, MAX_HISTORY_HOURS);
    source
        .fetch(source.url("gpu-history", &[("hours", hours.to_string())]))
        .await
}

/// The Tokens page's figures: totals, latency percentiles and energy per token
/// (docs/power.md, "Token documents").
pub async fn tokens(State(state): State<AppState>) -> Response {
    let Some(source) = state.power.as_deref() else {
        return not_configured();
    };
    source.fetch(source.url("tokens", &[])).await
}

/// Token throughput and latency over the last N hours, in the history bounds.
pub async fn token_history(
    State(state): State<AppState>,
    Query(q): Query<HistoryQuery>,
) -> Response {
    let Some(source) = state.power.as_deref() else {
        return not_configured();
    };
    let hours = bounded(q.hours, DEFAULT_HISTORY_HOURS, MAX_HISTORY_HOURS);
    source
        .fetch(source.url("token-history", &[("hours", hours.to_string())]))
        .await
}

/// Tokens per local day and hour, in the daily bounds.
pub async fn token_daily(State(state): State<AppState>, Query(q): Query<DailyQuery>) -> Response {
    let Some(source) = state.power.as_deref() else {
        return not_configured();
    };
    let days = bounded(q.days, DEFAULT_DAILY_DAYS, MAX_DAILY_DAYS);
    source
        .fetch(source.url("token-daily", &[("days", days.to_string())]))
        .await
}

/// The Host page's figures beyond the snapshot: sensors, BMC, arrays, drives,
/// filesystems, links and services (docs/power.md, "Host documents").
pub async fn host(State(state): State<AppState>) -> Response {
    let Some(source) = state.power.as_deref() else {
        return not_configured();
    };
    source.fetch(source.url("host", &[])).await
}

/// The host over the last N hours, in the history bounds.
pub async fn host_history(
    State(state): State<AppState>,
    Query(q): Query<HistoryQuery>,
) -> Response {
    let Some(source) = state.power.as_deref() else {
        return not_configured();
    };
    let hours = bounded(q.hours, DEFAULT_HISTORY_HOURS, MAX_HISTORY_HOURS);
    source
        .fetch(source.url("host-history", &[("hours", hours.to_string())]))
        .await
}

pub async fn daily(State(state): State<AppState>, Query(q): Query<DailyQuery>) -> Response {
    let Some(source) = state.power.as_deref() else {
        return not_configured();
    };
    let days = bounded(q.days, DEFAULT_DAILY_DAYS, MAX_DAILY_DAYS);
    source
        .fetch(source.url("daily", &[("days", days.to_string())]))
        .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn documents_join_under_the_base_path_with_or_without_a_slash() {
        for base in ["http://127.0.0.1:9/power", "http://127.0.0.1:9/power/"] {
            let source = PowerSource::new(base).unwrap();
            assert_eq!(
                source.url("now", &[]).as_str(),
                "http://127.0.0.1:9/power/now"
            );
        }
        let root = PowerSource::new("http://127.0.0.1:9").unwrap();
        assert_eq!(
            root.url("history", &[("hours", "24".into())]).as_str(),
            "http://127.0.0.1:9/history?hours=24"
        );
    }

    #[test]
    fn only_http_sources_are_accepted() {
        assert!(PowerSource::new("file:///etc/passwd").is_err());
        assert!(PowerSource::new("not a url").is_err());
        assert!(PowerSource::new("https://power.example").is_ok());
    }

    #[test]
    fn windows_are_clamped_to_their_bounds() {
        assert_eq!(bounded(None, DEFAULT_HISTORY_HOURS, MAX_HISTORY_HOURS), 24);
        assert_eq!(
            bounded(Some(0), DEFAULT_HISTORY_HOURS, MAX_HISTORY_HOURS),
            1
        );
        assert_eq!(
            bounded(Some(10_000), DEFAULT_HISTORY_HOURS, MAX_HISTORY_HOURS),
            168
        );
        assert_eq!(bounded(Some(400), DEFAULT_DAILY_DAYS, MAX_DAILY_DAYS), 31);
    }

    /// A stand-in power source: `/now` answers a fixed document, `/history`
    /// echoes the query it was sent, `/daily` fails, and `/big` is oversized.
    async fn spawn_source() -> String {
        use axum::extract::RawQuery;
        use axum::routing::get;
        let app = axum::Router::new()
            .route("/now", get(|| async { r#"{"total":{"watts":512}}"# }))
            .route(
                "/history",
                get(|RawQuery(q): RawQuery| async move {
                    format!(r#"{{"query":"{}"}}"#, q.unwrap_or_default())
                }),
            )
            .route(
                "/daily",
                get(|| async { (StatusCode::INTERNAL_SERVER_ERROR, "boom") }),
            )
            .route(
                "/recent",
                get(|RawQuery(q): RawQuery| async move {
                    format!(r#"{{"query":"{}"}}"#, q.unwrap_or_default())
                }),
            )
            .route("/gpus", get(|| async { r#"{"gpus":[]}"# }))
            .route("/tokens", get(|| async { r#"{"today":{}}"# }))
            .route("/host", get(|| async { r#"{"arrays":[]}"# }))
            .route(
                "/token-daily",
                get(|RawQuery(q): RawQuery| async move {
                    format!(r#"{{"query":"{}"}}"#, q.unwrap_or_default())
                }),
            )
            .route(
                "/gpu-history",
                get(|RawQuery(q): RawQuery| async move {
                    format!(r#"{{"query":"{}"}}"#, q.unwrap_or_default())
                }),
            );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        format!("http://{addr}")
    }

    async fn spawn_dashboard(power: Option<PowerSource>, dir: &std::path::Path) -> String {
        let (tx, _rx) = tokio::sync::broadcast::channel::<String>(16);
        let app = crate::server::create_router(AppState {
            metrics_tx: tx,
            history: std::sync::Arc::new(crate::history::SnapshotHistory::new(1000)),
            config: std::sync::Arc::new(crate::config_store::ConfigStore::new(dir).await),
            power: power.map(std::sync::Arc::new),
        });
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        format!("http://{addr}")
    }

    #[tokio::test]
    async fn documents_are_relayed_unchanged_with_bounded_queries() {
        let dir = tempfile::tempdir().unwrap();
        let source = PowerSource::new(&spawn_source().await).unwrap();
        let base = spawn_dashboard(Some(source), dir.path()).await;

        let now = reqwest::get(format!("{base}/api/power/now")).await.unwrap();
        assert_eq!(now.status(), reqwest::StatusCode::OK);
        assert_eq!(now.headers()[header::CONTENT_TYPE], "application/json");
        assert_eq!(now.text().await.unwrap(), r#"{"total":{"watts":512}}"#);

        // An out-of-range window is clamped, and nothing else is passed on.
        let history = reqwest::get(format!(
            "{base}/api/power/history?hours=9999&url=http://elsewhere"
        ))
        .await
        .unwrap();
        assert_eq!(history.text().await.unwrap(), r#"{"query":"hours=168"}"#);

        // The live strips' window, clamped to the longest chart window.
        let recent = reqwest::get(format!("{base}/api/power/recent?minutes=60"))
            .await
            .unwrap();
        assert_eq!(recent.text().await.unwrap(), r#"{"query":"minutes=15"}"#);
        let recent = reqwest::get(format!("{base}/api/power/recent"))
            .await
            .unwrap();
        assert_eq!(recent.text().await.unwrap(), r#"{"query":"minutes=5"}"#);

        // The GPUs page's documents, under the same rules.
        let gpus = reqwest::get(format!("{base}/api/power/gpus"))
            .await
            .unwrap();
        assert_eq!(gpus.text().await.unwrap(), r#"{"gpus":[]}"#);
        let gpu_history = reqwest::get(format!("{base}/api/power/gpu-history?hours=0&x=1"))
            .await
            .unwrap();
        assert_eq!(gpu_history.text().await.unwrap(), r#"{"query":"hours=1"}"#);

        // And the Tokens page's.
        let tokens = reqwest::get(format!("{base}/api/power/tokens"))
            .await
            .unwrap();
        assert_eq!(tokens.text().await.unwrap(), r#"{"today":{}}"#);
        let token_daily = reqwest::get(format!("{base}/api/power/token-daily?days=99"))
            .await
            .unwrap();
        assert_eq!(token_daily.text().await.unwrap(), r#"{"query":"days=31"}"#);

        // And the Host page's.
        let host = reqwest::get(format!("{base}/api/power/host"))
            .await
            .unwrap();
        assert_eq!(host.text().await.unwrap(), r#"{"arrays":[]}"#);
    }

    #[tokio::test]
    async fn a_failing_source_is_a_bad_gateway() {
        let dir = tempfile::tempdir().unwrap();
        let source = PowerSource::new(&spawn_source().await).unwrap();
        let base = spawn_dashboard(Some(source), dir.path()).await;

        let daily = reqwest::get(format!("{base}/api/power/daily"))
            .await
            .unwrap();
        assert_eq!(daily.status(), reqwest::StatusCode::BAD_GATEWAY);
        assert_eq!(daily.text().await.unwrap(), "power source answered 500");
    }

    #[tokio::test]
    async fn an_unreachable_source_is_a_bad_gateway() {
        let dir = tempfile::tempdir().unwrap();
        // Port 9 (discard) on loopback: nothing listens there in a test run.
        let base = spawn_dashboard(
            Some(PowerSource::new("http://127.0.0.1:9").unwrap()),
            dir.path(),
        )
        .await;

        let now = reqwest::get(format!("{base}/api/power/now")).await.unwrap();
        assert_eq!(now.status(), reqwest::StatusCode::BAD_GATEWAY);
    }

    #[tokio::test]
    async fn without_a_source_every_power_route_is_not_found() {
        let dir = tempfile::tempdir().unwrap();
        let base = spawn_dashboard(None, dir.path()).await;

        for path in [
            "now",
            "recent",
            "history",
            "daily",
            "gpus",
            "gpu-history",
            "tokens",
            "token-history",
            "token-daily",
            "host",
            "host-history",
        ] {
            let resp = reqwest::get(format!("{base}/api/power/{path}"))
                .await
                .unwrap();
            assert_eq!(resp.status(), reqwest::StatusCode::NOT_FOUND, "{path}");
            assert_eq!(resp.text().await.unwrap(), "no power source configured");
        }
    }
}
