use super::{RunToolResponse, ToolSecurityConfig};
use serde_json::{json, Value};
use std::fs;

pub fn run(_security: &ToolSecurityConfig, _input: Value) -> Result<RunToolResponse, String> {
  // Screenshot doesn't touch arbitrary paths; it writes into ~/.tental/screenshots
  let dir = crate::get_tental_dir_path()?.join("screenshots");
  fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
  let ts = super::helpers_now_ms();
  let out_path = dir.join(format!("screenshot-{}.png", ts));

  let screens = screenshots::Screen::all().map_err(|e| e.to_string())?;
  let screen = screens
    .get(0)
    .ok_or_else(|| "no screen found".to_string())?;
  let image = screen.capture().map_err(|e| e.to_string())?;
  // screenshots uses image crate internally
  image
    .save(&out_path)
    .map_err(|e| e.to_string())?;

  Ok(RunToolResponse {
    ok: true,
    name: "screenshot".to_string(),
    output: json!({ "path": out_path.to_string_lossy().to_string() }),
    error: None,
    error_code: None,
  })
}

