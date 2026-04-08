use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

use crate::get_tental_dir_path;

fn chat_store_path() -> Result<PathBuf, String> {
  Ok(get_tental_dir_path()?.join("chat-store.json"))
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ChatSession {
  pub id: String,
  pub title: String,
  pub updated_at: i64,
  #[serde(default)]
  pub pending_tool_approval: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
  pub id: String,
  pub role: String,
  pub content: String,
  pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ChatStore {
  #[serde(default)]
  pub sessions: Vec<ChatSession>,
  #[serde(default)]
  pub messages: HashMap<String, Vec<ChatMessage>>,
}

pub fn load_chat_store_disk() -> Result<ChatStore, String> {
  let path = chat_store_path()?;
  if !path.exists() {
    return Ok(ChatStore::default());
  }
  let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
  serde_json::from_str(&content).map_err(|e| e.to_string())
}

pub fn save_chat_store_disk(store: &ChatStore) -> Result<(), String> {
  let path = chat_store_path()?;
  let content = serde_json::to_string_pretty(store).map_err(|e| e.to_string())?;
  fs::write(path, content).map_err(|e| e.to_string())
}
