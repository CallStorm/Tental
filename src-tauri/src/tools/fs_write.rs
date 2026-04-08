use super::{helpers_check_path_allowed, RunToolResponse, ToolSecurityConfig};
use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;

pub fn run(security: &ToolSecurityConfig, input: Value) -> Result<RunToolResponse, String> {
  let path = input
    .get("path")
    .and_then(|v| v.as_str())
    .ok_or_else(|| "missing input.path".to_string())?;
  let content = input
    .get("content")
    .and_then(|v| v.as_str())
    .ok_or_else(|| "missing input.content".to_string())?;

  let bytes = content.as_bytes().len() as u64;
  if bytes > security.max_file_bytes {
    return Ok(RunToolResponse {
      ok: false,
      name: "write_file".to_string(),
      output: json!({ "maxFileBytes": security.max_file_bytes, "actualBytes": bytes }),
      error: Some("file_too_large".to_string()),
      error_code: Some("file_too_large".to_string()),
    });
  }

  let p = PathBuf::from(path);
  helpers_check_path_allowed(security, &p)?;

  if let Some(parent) = p.parent() {
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
  }

  // Atomic-ish write: write to temp then rename.
  let tmp = p.with_extension(format!("tmp.{}", super::helpers_now_ms()));
  fs::write(&tmp, content).map_err(|e| e.to_string())?;
  fs::rename(&tmp, &p).map_err(|e| e.to_string())?;

  Ok(RunToolResponse {
    ok: true,
    name: "write_file".to_string(),
    output: json!({ "path": path, "bytes": bytes }),
    error: None,
    error_code: None,
  })
}

