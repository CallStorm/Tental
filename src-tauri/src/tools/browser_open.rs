use super::{RunToolResponse, ToolSecurityConfig};
use serde_json::{json, Value};
use std::process::Command;

pub fn run(_security: &ToolSecurityConfig, input: Value) -> Result<RunToolResponse, String> {
  let target = input
    .get("target")
    .and_then(|v| v.as_str())
    .ok_or_else(|| "missing input.target".to_string())?
    .to_string();

  let status = if cfg!(windows) {
    Command::new("cmd")
      .arg("/C")
      .arg("start")
      .arg("")
      .arg(&target)
      .status()
      .map_err(|e| e.to_string())?
  } else if cfg!(target_os = "macos") {
    Command::new("open")
      .arg(&target)
      .status()
      .map_err(|e| e.to_string())?
  } else {
    Command::new("xdg-open")
      .arg(&target)
      .status()
      .map_err(|e| e.to_string())?
  };

  Ok(RunToolResponse {
    ok: status.success(),
    name: "browser_open".to_string(),
    output: json!({ "target": target, "exitCode": status.code() }),
    error: if status.success() { None } else { Some("non_zero_exit".to_string()) },
    error_code: if status.success() { None } else { Some("non_zero_exit".to_string()) },
  })
}

