use super::RunToolResponse;
use serde_json::{json, Value};
use std::time::{SystemTime, UNIX_EPOCH};

pub fn run(_input: Value) -> Result<RunToolResponse, String> {
  let now_local = chrono::Local::now();
  let now_utc = chrono::Utc::now();
  let unix_ms = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map_err(|e| e.to_string())?
    .as_millis() as i64;

  Ok(RunToolResponse {
    ok: true,
    name: "get_current_time".to_string(),
    output: json!({
      "local": now_local.to_rfc3339(),
      "utc": now_utc.to_rfc3339(),
      "timezone": now_local.offset().to_string(),
      "unixMs": unix_ms
    }),
    error: None,
    error_code: None,
  })
}
