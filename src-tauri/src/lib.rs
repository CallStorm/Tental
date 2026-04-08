use serde::{Deserialize, Serialize};
use serde_json::json;
use std::fs;
use std::path::PathBuf;
use std::time::Duration;

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

fn get_tental_dir_path() -> Result<PathBuf, String> {
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

/// 1x1 transparent PNG (base64) for lightweight multimodal probe.
const TINY_PNG_B64: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

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

fn http_client() -> Result<reqwest::blocking::Client, String> {
  reqwest::blocking::Client::builder()
    .timeout(Duration::from_secs(45))
    .build()
    .map_err(|e| e.to_string())
}

fn summarize_api_error(status: reqwest::StatusCode, body: &str) -> String {
  if let Ok(v) = serde_json::from_str::<serde_json::Value>(body) {
    if let Some(msg) = v.get("error").and_then(|e| e.get("message")).and_then(|m| m.as_str()) {
      return format!("HTTP {} — {}", status, msg);
    }
    if let Some(msg) = v.get("message").and_then(|m| m.as_str()) {
      return format!("HTTP {} — {}", status, msg);
    }
  }
  let trimmed: String = body.chars().take(500).collect();
  if trimmed.is_empty() {
    format!("HTTP {}", status)
  } else {
    format!("HTTP {} — {}", status, trimmed)
  }
}

fn extract_anthropic_reply(text: &str) -> Option<String> {
  let v: serde_json::Value = serde_json::from_str(text).ok()?;
  let content = v.get("content")?.as_array()?;
  for block in content {
    if let Some(t) = block.get("text").and_then(|x| x.as_str()) {
      let s = t.trim();
      if !s.is_empty() {
        return Some(s.chars().take(120).collect());
      }
    }
  }
  None
}

fn extract_openai_reply(text: &str) -> Option<String> {
  let v: serde_json::Value = serde_json::from_str(text).ok()?;
  v.get("choices")?
    .get(0)?
    .get("message")?
    .get("content")?
    .as_str()
    .map(|s| s.trim().chars().take(120).collect())
}

#[tauri::command]
fn test_model_endpoint(req: TestModelRequest) -> Result<String, String> {
  let client = http_client()?;
  let key = req.api_key.trim();
  if key.is_empty() {
    return Err("请填写 API 密钥".to_string());
  }

  match req.provider_type.as_str() {
    "minimax_cn" => {
      let url = format!(
        "{}/v1/messages",
        req.base_url.trim_end_matches('/')
      );
      let body = if req.test_kind == "multimodal" {
        json!({
          "model": req.model,
          "max_tokens": 32,
          "messages": [{
            "role": "user",
            "content": [
              {"type": "text", "text": "请用一句话描述这张图（若无法识别也可简短回复）。"},
              {"type": "image", "source": {
                "type": "base64",
                "media_type": "image/png",
                "data": TINY_PNG_B64
              }}
            ]
          }]
        })
      } else {
        json!({
          "model": req.model,
          "max_tokens": 16,
          "messages": [{
            "role": "user",
            "content": "Reply with the single word: pong"
          }]
        })
      };

      let res = client
        .post(&url)
        .header("x-api-key", key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .map_err(|e| e.to_string())?;

      let status = res.status();
      let text = res.text().map_err(|e| e.to_string())?;
      if !status.is_success() {
        return Err(summarize_api_error(status, &text));
      }
      let snippet = extract_anthropic_reply(&text).unwrap_or_else(|| "OK".to_string());
      Ok(format!("成功：{}", snippet))
    }
    "deepseek" => {
      let base = req.base_url.trim_end_matches('/');
      let url = format!("{}/v1/chat/completions", base);

      let body = if req.test_kind == "multimodal" {
        json!({
          "model": req.model,
          "max_tokens": 32,
          "messages": [{
            "role": "user",
            "content": [
              {"type": "text", "text": "描述这张图片（若不支持图片可说明）。"},
              {"type": "image_url", "image_url": {"url": format!("data:image/png;base64,{}", TINY_PNG_B64)}}
            ]
          }]
        })
      } else {
        json!({
          "model": req.model,
          "max_tokens": 16,
          "messages": [{"role": "user", "content": "ping"}]
        })
      };

      let res = client
        .post(&url)
        .bearer_auth(key)
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .map_err(|e| e.to_string())?;

      let status = res.status();
      let text = res.text().map_err(|e| e.to_string())?;
      if !status.is_success() {
        return Err(summarize_api_error(status, &text));
      }
      let snippet = extract_openai_reply(&text).unwrap_or_else(|| "OK".to_string());
      Ok(format!("成功：{}", snippet))
    }
    other => Err(format!("未知供应商类型: {}", other)),
  }
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
      test_model_endpoint
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
