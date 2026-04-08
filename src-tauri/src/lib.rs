mod chat_store;
mod llm;

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

pub use chat_store::{ChatMessage, ChatSession, ChatStore};

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

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ModelProvider {
  pub id: String,
  pub provider_type: String,
  pub api_key: String,
  pub model: String,
  pub base_url: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ModelConfig {
  pub default_provider_id: Option<String>,
  pub providers: Vec<ModelProvider>,
}

pub(crate) fn get_tental_dir_path() -> Result<PathBuf, String> {
  let home = dirs::home_dir().ok_or("Cannot resolve user home directory")?;
  let app_dir = home.join(".tental");
  fs::create_dir_all(&app_dir).map_err(|err| err.to_string())?;
  Ok(app_dir)
}

fn get_config_path() -> Result<PathBuf, String> {
  Ok(get_tental_dir_path()?.join("config.json"))
}

fn get_model_config_path() -> Result<PathBuf, String> {
  Ok(get_tental_dir_path()?.join("model.json"))
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

#[tauri::command]
fn load_model_config() -> Result<ModelConfig, String> {
  let path = get_model_config_path()?;
  if !path.exists() {
    return Ok(ModelConfig::default());
  }
  let content = fs::read_to_string(path).map_err(|err| err.to_string())?;
  serde_json::from_str::<ModelConfig>(&content).map_err(|err| err.to_string())
}

#[tauri::command]
fn save_model_config(config: ModelConfig) -> Result<(), String> {
  let path = get_model_config_path()?;
  let content = serde_json::to_string_pretty(&config).map_err(|err| err.to_string())?;
  fs::write(path, content).map_err(|err| err.to_string())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TestModelRequest {
  provider_type: String,
  base_url: String,
  api_key: String,
  model: String,
  /// `connection` | `multimodal`
  test_kind: String,
}

#[tauri::command]
fn test_model_endpoint(req: TestModelRequest) -> Result<String, String> {
  llm::run_test_model_endpoint(llm::TestModelInput {
    provider_type: req.provider_type.as_str(),
    base_url: req.base_url.as_str(),
    api_key: req.api_key.as_str(),
    model: req.model.as_str(),
    test_kind: req.test_kind.as_str(),
  })
}

#[tauri::command]
fn load_chat_store() -> Result<ChatStore, String> {
  chat_store::load_chat_store_disk()
}

#[tauri::command]
fn save_chat_store(store: ChatStore) -> Result<(), String> {
  chat_store::save_chat_store_disk(&store)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatTurn {
  role: String,
  content: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CompleteChatRequest {
  /// When null, uses `ModelConfig.default_provider_id`.
  provider_id: Option<String>,
  messages: Vec<ChatTurn>,
}

fn resolve_provider<'a>(
  model: &'a ModelConfig,
  provider_id: Option<&str>,
) -> Result<&'a ModelProvider, String> {
  let id = provider_id
    .map(|s| s.to_string())
    .or(model.default_provider_id.clone())
    .ok_or_else(|| "请先在设置中配置并选择默认模型供应商".to_string())?;
  model
    .providers
    .iter()
    .find(|p| p.id == id)
    .ok_or_else(|| format!("找不到供应商: {}", id))
}

#[tauri::command]
fn complete_chat(req: CompleteChatRequest) -> Result<String, String> {
  let model_config = load_model_config()?;
  let provider = resolve_provider(&model_config, req.provider_id.as_deref())?;
  let pairs: Vec<(String, String)> = req
    .messages
    .into_iter()
    .map(|m| (m.role, m.content))
    .collect();
  llm::complete_chat(provider, &pairs)
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
      save_config,
      load_model_config,
      save_model_config,
      test_model_endpoint,
      load_chat_store,
      save_chat_store,
      complete_chat,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
