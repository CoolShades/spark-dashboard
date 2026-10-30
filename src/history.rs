//! The last few minutes of snapshots, kept by the server.
//!
//! A browser only charts what it received. A tab that was closed, asleep, or
//! hidden (the client stops drawing then) would otherwise come back to a
//! straight line across the minutes it missed. The client asks this buffer for
//! everything newer than its last sample when its socket opens.

use std::collections::VecDeque;
use std::sync::Mutex;

use axum::extract::{Query, State};
use axum::response::IntoResponse;

use crate::metrics::MetricsSnapshot;
use crate::server::AppState;

/// The longest window a chart offers (`TimeWindow` '15m' in the frontend).
pub const HISTORY_SECS: u64 = 15 * 60;

/// Snapshots in arrival order, each already serialized, so a request copies
/// strings instead of serializing fifteen minutes of structs.
pub struct SnapshotHistory {
    capacity: usize,
    entries: Mutex<VecDeque<(u64, String)>>,
}

impl SnapshotHistory {
    /// Room for [`HISTORY_SECS`] at the collector's poll interval.
    pub fn new(poll_interval_ms: u64) -> Self {
        let capacity = (HISTORY_SECS * 1000 / poll_interval_ms.max(1)).max(1) as usize;
        Self {
            capacity,
            entries: Mutex::new(VecDeque::with_capacity(capacity)),
        }
    }

    /// Keep one snapshot, slimmed to what a chart reads (see [`slim`]).
    pub fn record(&self, snapshot: &MetricsSnapshot) {
        match serde_json::to_string(&slim(snapshot)) {
            Ok(json) => self.push(snapshot.timestamp_ms, json),
            Err(e) => tracing::error!("Failed to serialize a history snapshot: {}", e),
        }
    }

    pub(crate) fn push(&self, timestamp_ms: u64, json: String) {
        let mut entries = self.entries.lock().unwrap_or_else(|e| e.into_inner());
        if entries.len() == self.capacity {
            entries.pop_front();
        }
        entries.push_back((timestamp_ms, json));
    }

    /// A JSON array of the snapshots newer than `since_ms`, oldest first.
    pub fn since(&self, since_ms: u64) -> String {
        let entries = self.entries.lock().unwrap_or_else(|e| e.into_inner());
        let newer: Vec<&str> = entries
            .iter()
            .filter(|(at, _)| *at > since_ms)
            .map(|(_, json)| json.as_str())
            .collect();
        let mut out = String::with_capacity(newer.iter().map(|j| j.len() + 1).sum::<usize>() + 2);
        out.push('[');
        out.push_str(&newer.join(","));
        out.push(']');
        out
    }
}

/// A snapshot without the parts only the newest one is read for: the per-core
/// CPU grid and the cumulative latency histograms. They are over half of each
/// snapshot, and a chart's series never reads them.
fn slim(snapshot: &MetricsSnapshot) -> MetricsSnapshot {
    let mut slim = snapshot.clone();
    slim.cpu.per_core.clear();
    for engine in &mut slim.engines {
        if let Some(m) = engine.metrics.as_mut() {
            m.ttft_buckets = None;
            m.itl_buckets = None;
            m.e2e_buckets = None;
            m.tpot_buckets = None;
        }
    }
    slim
}

#[derive(serde::Deserialize)]
pub struct HistoryQuery {
    /// The newest timestamp (ms) the client already has; omitted for all of it.
    since: Option<u64>,
}

/// `GET /api/metrics/history?since=<ms>`: the snapshots the client missed.
pub async fn history(
    State(state): State<AppState>,
    Query(q): Query<HistoryQuery>,
) -> impl IntoResponse {
    (
        [(axum::http::header::CONTENT_TYPE, "application/json")],
        state.history.since(q.since.unwrap_or(0)),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn holds_fifteen_minutes_at_the_poll_interval() {
        assert_eq!(SnapshotHistory::new(1000).capacity, 900);
        assert_eq!(SnapshotHistory::new(500).capacity, 1800);
        assert_eq!(SnapshotHistory::new(0).capacity, 900_000);
    }

    #[test]
    fn drops_the_oldest_when_full_and_answers_only_what_is_newer() {
        let h = SnapshotHistory {
            capacity: 3,
            entries: Mutex::new(VecDeque::new()),
        };
        for at in 1..=4 {
            h.push(at * 1000, format!("{{\"timestamp_ms\":{}}}", at * 1000));
        }
        assert_eq!(
            h.since(0),
            r#"[{"timestamp_ms":2000},{"timestamp_ms":3000},{"timestamp_ms":4000}]"#
        );
        assert_eq!(h.since(3000), r#"[{"timestamp_ms":4000}]"#);
        assert_eq!(h.since(4000), "[]");
    }
}
