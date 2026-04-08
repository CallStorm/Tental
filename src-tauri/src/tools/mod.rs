use crate::get_tental_dir_path;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

mod fs_edit;
mod get_current_time;
mod fs_read;
mod fs_write;
mod shell_exec;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolMeta {
  pub id: String,
  pub name: String,
  pub description: String,
  /// `safe` | `danger`
  pub risk: String,
  pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolEnabledConfig {
  #[serde(default)]
  pub enabled: HashMap<String, bool>,
}

impl Default for ToolEnabledConfig {
  fn default() -> Self {
    Self {
      enabled: HashMap::new(),
    }
  }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolSecurityConfig {
  /// When empty, allow all paths (default).
  #[serde(default)]
  pub allowed_roots: Vec<String>,

  /// Commands/patterns requiring approval (danger).
  #[serde(default)]
  pub command_blacklist: Vec<String>,

  /// Max bytes allowed to read/write.
  #[serde(default)]
  pub max_file_bytes: u64,

  /// Max lines returned for file read.
  #[serde(default)]
  pub max_read_lines: usize,

  /// Reject binary files when reading.
  #[serde(default)]
  pub reject_binary: bool,
}

impl Default for ToolSecurityConfig {
  fn default() -> Self {
    Self {
      allowed_roots: vec![], // default: no restriction
      command_blacklist: vec![
        "rm",
        "del",
        "rmdir",
        "rd",
        "format",
        "diskpart",
        "shutdown",
        "reboot",
        "poweroff",
        "mkfs",
        "dd",
        "Remove-Item",
        "Clear-Item",
      ]
      .into_iter()
      .map(|s| s.to_string())
      .collect(),
      max_file_bytes: 5 * 1024 * 1024,
      max_read_lines: 2000,
      reject_binary: true,
    }
  }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunToolResponse {
  pub ok: bool,
  pub name: String,
  pub output: Value,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub error: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub error_code: Option<String>,
}

fn now_ms() -> i64 {
  let n = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .unwrap_or(Duration::from_secs(0));
  n.as_millis() as i64
}

fn tools_enabled_path() -> Result<PathBuf, String> {
  Ok(get_tental_dir_path()?.join("tools.json"))
}

fn tools_security_path() -> Result<PathBuf, String> {
  Ok(get_tental_dir_path()?.join("tools-security.json"))
}

pub fn load_enabled_config() -> Result<ToolEnabledConfig, String> {
  let path = tools_enabled_path()?;
  if !path.exists() {
    return Ok(ToolEnabledConfig::default());
  }
  let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
  Ok(serde_json::from_str::<ToolEnabledConfig>(&content).unwrap_or_else(|_| ToolEnabledConfig::default()))
}

pub fn save_enabled_config(cfg: &ToolEnabledConfig) -> Result<(), String> {
  let path = tools_enabled_path()?;
  let content = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
  fs::write(path, content).map_err(|e| e.to_string())
}

pub fn load_security_config() -> Result<ToolSecurityConfig, String> {
  let path = tools_security_path()?;
  if !path.exists() {
    return Ok(ToolSecurityConfig::default());
  }
  let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
  let cfg = serde_json::from_str::<ToolSecurityConfig>(&content).unwrap_or_default();
  Ok(ToolSecurityConfig {
    // keep forward-compat defaults if missing
    max_file_bytes: if cfg.max_file_bytes == 0 { ToolSecurityConfig::default().max_file_bytes } else { cfg.max_file_bytes },
    max_read_lines: if cfg.max_read_lines == 0 { ToolSecurityConfig::default().max_read_lines } else { cfg.max_read_lines },
    ..cfg
  })
}

pub fn save_security_config(cfg: &ToolSecurityConfig) -> Result<(), String> {
  let path = tools_security_path()?;
  let content = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
  fs::write(path, content).map_err(|e| e.to_string())
}

fn all_tool_defs() -> Vec<(String, String, String, String)> {
  let os_name = match std::env::consts::OS {
    "windows" => "Windows",
    "macos" => "macOS",
    "linux" => "Linux",
    other => other,
  };
  vec![
    (
      "bash".to_string(),
      "Bash".to_string(),
      format!("Run a shell command on current OS ({}).", os_name),
      "danger".to_string(),
    ),
    (
      "read_file".to_string(),
      "Read File".to_string(),
      "Read file contents.".to_string(),
      "safe".to_string(),
    ),
    (
      "write_file".to_string(),
      "Write File".to_string(),
      "Write content to file.".to_string(),
      "danger".to_string(),
    ),
    (
      "edit_file".to_string(),
      "Edit File".to_string(),
      "Replace exact text in file.".to_string(),
      "danger".to_string(),
    ),
    (
      "get_current_time".to_string(),
      "Get Current Time".to_string(),
      "Get current date and time.".to_string(),
      "safe".to_string(),
    ),
  ]
}

pub fn list_tools() -> Result<Vec<ToolMeta>, String> {
  let enabled_cfg = load_enabled_config()?;
  let mut out = Vec::new();
  for (id, name, description, risk) in all_tool_defs() {
    let enabled = enabled_cfg.enabled.get(&id).copied().unwrap_or(true);
    out.push(ToolMeta {
      id,
      name,
      description,
      risk,
      enabled,
    });
  }
  Ok(out)
}

pub fn set_tool_enabled(tool_id: &str, enabled: bool) -> Result<(), String> {
  let mut cfg = load_enabled_config()?;
  cfg.enabled.insert(tool_id.to_string(), enabled);
  save_enabled_config(&cfg)
}

fn normalize_path(p: &Path) -> Result<PathBuf, String> {
  let abs = if p.is_absolute() {
    p.to_path_buf()
  } else {
    std::env::current_dir()
      .map_err(|e| e.to_string())?
      .join(p)
  };
  Ok(abs)
}

fn check_path_allowed(security: &ToolSecurityConfig, path: &Path) -> Result<(), String> {
  if security.allowed_roots.is_empty() {
    return Ok(());
  }
  let p = normalize_path(path)?;
  let p_str = p.to_string_lossy().to_string();
  for root in &security.allowed_roots {
    if root.trim().is_empty() {
      continue;
    }
    let r = PathBuf::from(root);
    let r_abs = normalize_path(&r)?;
    if p.starts_with(&r_abs) {
      return Ok(());
    }
  }
  Err(format!("路径不在允许范围内: {}", p_str))
}

fn tool_enabled(tool_id: &str) -> Result<(), String> {
  let cfg = load_enabled_config()?;
  let enabled = cfg.enabled.get(tool_id).copied().unwrap_or(true);
  if enabled {
    Ok(())
  } else {
    Err(format!("工具已禁用: {}", tool_id))
  }
}

pub fn run_tool(name: &str, input: Value) -> Result<RunToolResponse, String> {
  tool_enabled(name).map_err(|e| e)?;
  let security = load_security_config()?;

  match name {
    "bash" => shell_exec::run(&security, input, true),
    "read_file" => fs_read::run(&security, input),
    "write_file" => fs_write::run(&security, input),
    "edit_file" => fs_edit::run(&security, input),
    "get_current_time" => get_current_time::run(input),
    other => Ok(RunToolResponse {
      ok: false,
      name: other.to_string(),
      output: json!({}),
      error: Some(format!("unknown tool: {}", other)),
      error_code: Some("unknown_tool".to_string()),
    }),
  }
}

pub fn helpers_check_path_allowed(security: &ToolSecurityConfig, path: &Path) -> Result<(), String> {
  check_path_allowed(security, path)
}

pub fn helpers_now_ms() -> i64 {
  now_ms()
}

