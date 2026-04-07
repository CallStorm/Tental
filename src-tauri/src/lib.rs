use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize)]
#[serde(default)]
struct AppConfig {
  theme: String,
  language: String,
}

impl Default for AppConfig {
  fn default() -> Self {
    Self {
      theme: "system".to_string(),
      language: "zh".to_string(),
    }
  }
}

fn get_tental_dir_path() -> Result<PathBuf, String> {
  let home = dirs::home_dir().ok_or("Cannot resolve user home directory")?;
  let app_dir = home.join(".tental");
  fs::create_dir_all(&app_dir).map_err(|err| err.to_string())?;
  Ok(app_dir)
}

fn get_config_path() -> Result<PathBuf, String> {
  Ok(get_tental_dir_path()?.join("config.json"))
}

#[tauri::command]
fn get_tental_dir() -> Result<String, String> {
  Ok(get_tental_dir_path()?.to_string_lossy().to_string())
}

#[tauri::command]
fn load_config() -> Result<AppConfig, String> {
  let config_path = get_config_path()?;
  if !config_path.exists() {
    return Ok(AppConfig::default());
  }

  let content = fs::read_to_string(config_path).map_err(|err| err.to_string())?;
  let config = serde_json::from_str::<AppConfig>(&content).unwrap_or_default();
  Ok(config)
}

#[tauri::command]
fn save_config(config: AppConfig) -> Result<(), String> {
  let config_path = get_config_path()?;
  let content = serde_json::to_string_pretty(&config).map_err(|err| err.to_string())?;
  fs::write(config_path, content).map_err(|err| err.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      get_tental_dir,
      load_config,
      save_config
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
