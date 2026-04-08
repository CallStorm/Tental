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
    .any(|x| {
      let rule = x.trim();
      !rule.is_empty()
        && (base.eq_ignore_ascii_case(rule)
          || base.to_ascii_lowercase().contains(&rule.to_ascii_lowercase()))
    })
}

fn classify_windows_shell_error(stderr: &str) -> &'static str {
  let s = stderr.to_ascii_lowercase();
  if s.contains("cannot find path")
    || s.contains("path_not_found")
    || s.contains("找不到路径")
    || s.contains("系统找不到指定的路径")
  {
    "path_not_found"
  } else if s.contains("access is denied") || s.contains("拒绝访问") {
    "permission_denied"
  } else if s.contains("is not recognized as an internal or external command")
    || s.contains("无法将")
    || s.contains("not recognized")
  {
    "command_not_found"
  } else if s.contains("parsererror")
    || s.contains("missing expression")
    || s.contains("语法")
    || s.contains("unexpected token")
  {
    "shell_syntax_error"
  } else {
    "non_zero_exit"
  }
}

#[cfg(test)]
mod tests {
  use super::{classify_windows_shell_error, is_blacklisted};
  use crate::tools::ToolSecurityConfig;

  #[test]
  fn classify_path_not_found() {
    let code = classify_windows_shell_error("系统找不到指定的路径。");
    assert_eq!(code, "path_not_found");
  }

  #[test]
  fn classify_command_not_found() {
    let code = classify_windows_shell_error(
      "'foo' is not recognized as an internal or external command, operable program or batch file.",
    );
    assert_eq!(code, "command_not_found");
  }

  #[test]
  fn classify_permission_denied() {
    let code = classify_windows_shell_error("Access is denied.");
    assert_eq!(code, "permission_denied");
  }

  #[test]
  fn blacklist_exact_match_detected() {
    let cfg = ToolSecurityConfig {
      command_blacklist: vec!["remove-item".to_string()],
      ..ToolSecurityConfig::default()
    };
    assert!(is_blacklisted(&cfg, "Remove-Item"));
  }

  #[test]
  fn blacklist_partial_rule_detected() {
    let cfg = ToolSecurityConfig {
      command_blacklist: vec!["stop-computer".to_string()],
      ..ToolSecurityConfig::default()
    };
    assert!(is_blacklisted(&cfg, "Microsoft.PowerShell.Management\\Stop-Computer"));
  }
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
    let wrapped = format!(
      "[Console]::InputEncoding = [Text.UTF8Encoding]::UTF8; \
[Console]::OutputEncoding = [Text.UTF8Encoding]::UTF8; \
$OutputEncoding = [Text.UTF8Encoding]::UTF8; {}",
      command
    );
    let mut c = Command::new("powershell.exe");
    c
      .arg("-NoProfile")
      .arg("-NonInteractive")
      .arg("-ExecutionPolicy")
      .arg("Bypass")
      .arg("-Command")
      .arg(&wrapped);
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

  let mut child = match cmd.spawn() {
    Ok(v) => v,
    Err(e) => {
      return Ok(RunToolResponse {
        ok: false,
        name: "bash".to_string(),
        output: json!({ "command": command }),
        error: Some(e.to_string()),
        error_code: Some("spawn_error".to_string()),
      })
    }
  };

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
        error: if status.success() {
          None
        } else {
          Some("non_zero_exit".to_string())
        },
        error_code: if status.success() {
          None
        } else if cfg!(windows) {
          Some(classify_windows_shell_error(&stderr).to_string())
        } else {
          Some("non_zero_exit".to_string())
        },
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

