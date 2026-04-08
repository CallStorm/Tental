use super::{RunToolResponse, ToolSecurityConfig};
use serde_json::{json, Value};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

fn base_command(cmd: &str) -> Option<String> {
  let trimmed = cmd.trim();
  if trimmed.is_empty() {
    return None;
  }
  let first = trimmed
    .split_whitespace()
    .next()
    .unwrap_or("")
    .trim_matches('"')
    .trim_matches('\'');
  if first.is_empty() {
    None
  } else {
    Some(first.to_string())
  }
}

fn is_blacklisted(security: &ToolSecurityConfig, base: &str) -> bool {
  security
    .command_blacklist
    .iter()
    .any(|x| x.eq_ignore_ascii_case(base))
}

pub fn run(security: &ToolSecurityConfig, input: Value, approved: bool) -> Result<RunToolResponse, String> {
  let command = input
    .get("command")
    .and_then(|v| v.as_str())
    .ok_or_else(|| "missing input.command".to_string())?
    .to_string();
  let cwd = input.get("cwd").and_then(|v| v.as_str()).map(|s| s.to_string());
  let timeout_ms = input.get("timeoutMs").and_then(|v| v.as_u64()).unwrap_or(30_000);

  let Some(base) = base_command(&command) else {
    return Ok(RunToolResponse {
      ok: false,
      name: "bash".to_string(),
      output: json!({}),
      error: Some("empty_command".to_string()),
      error_code: Some("empty_command".to_string()),
    });
  };

  if is_blacklisted(security, &base) && !approved {
    return Ok(RunToolResponse {
      ok: false,
      name: "bash".to_string(),
      output: json!({ "baseCommand": base, "reason": "blacklisted_command_requires_approval" }),
      error: Some("approval_required".to_string()),
      error_code: Some("approval_required".to_string()),
    });
  }

  let started = Instant::now();

  let mut cmd = if cfg!(windows) {
    let mut c = Command::new("cmd");
    c.arg("/C").arg(&command);
    c
  } else {
    let mut c = Command::new("sh");
    c.arg("-lc").arg(&command);
    c
  };

  if let Some(dir) = cwd {
    cmd.current_dir(dir);
  }
  cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());

  let mut child = cmd.spawn().map_err(|e| e.to_string())?;

  // Basic timeout loop using try_wait
  let deadline = Duration::from_millis(timeout_ms);
  loop {
    if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
      let out = child.wait_with_output().map_err(|e| e.to_string())?;
      let stdout = String::from_utf8_lossy(&out.stdout).to_string();
      let stderr = String::from_utf8_lossy(&out.stderr).to_string();
      let code = status.code().unwrap_or(-1);
      return Ok(RunToolResponse {
        ok: status.success(),
        name: "bash".to_string(),
        output: json!({
          "command": command,
          "exitCode": code,
          "stdout": stdout,
          "stderr": stderr,
          "durationMs": started.elapsed().as_millis(),
        }),
        error: if status.success() { None } else { Some("non_zero_exit".to_string()) },
        error_code: if status.success() { None } else { Some("non_zero_exit".to_string()) },
      });
    }
    if started.elapsed() >= deadline {
      let _ = child.kill();
      return Ok(RunToolResponse {
        ok: false,
        name: "bash".to_string(),
        output: json!({ "command": command, "timeoutMs": timeout_ms }),
        error: Some("timeout".to_string()),
        error_code: Some("timeout".to_string()),
      });
    }
    std::thread::sleep(Duration::from_millis(50));
  }
}

