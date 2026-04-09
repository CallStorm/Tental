use crate::get_tental_dir_path;
use reqwest::blocking::Client;
use reqwest::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE, HeaderMap, HeaderName, HeaderValue};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct McpHeader {
  pub key: String,
  pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpClientConfig {
  pub id: String,
  pub name: String,
  pub transport: String,
  pub url: String,
  #[serde(default)]
  pub headers: Vec<McpHeader>,
  #[serde(default)]
  pub bearer_token: String,
  #[serde(default = "default_enabled")]
  pub enabled: bool,
  pub created_at: i64,
  pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct McpClientStore {
  #[serde(default)]
  pub clients: Vec<McpClientConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveMcpClientRequest {
  pub id: Option<String>,
  pub name: String,
  pub url: String,
  #[serde(default)]
  pub headers: Vec<McpHeader>,
  #[serde(default)]
  pub bearer_token: String,
  #[serde(default = "default_enabled")]
  pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpConnectionTestResult {
  pub ok: bool,
  pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct McpToolMeta {
  pub name: String,
  #[serde(default)]
  pub description: String,
}

fn default_enabled() -> bool {
  true
}

fn now_ms() -> i64 {
  let n = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .unwrap_or(Duration::from_secs(0));
  n.as_millis() as i64
}

fn new_client_id() -> String {
  format!("mcp_{}", now_ms())
}

fn mcp_clients_path() -> Result<PathBuf, String> {
  Ok(get_tental_dir_path()?.join("mcp-clients.json"))
}

fn validate_http_url(url: &str) -> Result<(), String> {
  let v = url.trim().to_lowercase();
  if v.starts_with("http://") || v.starts_with("https://") {
    Ok(())
  } else {
    Err("URL 必须以 http:// 或 https:// 开头".to_string())
  }
}

fn normalize_headers(headers: &[McpHeader]) -> Vec<McpHeader> {
  headers
    .iter()
    .map(|h| McpHeader {
      key: h.key.trim().to_string(),
      value: h.value.trim().to_string(),
    })
    .filter(|h| !h.key.is_empty())
    .collect()
}

fn load_mcp_store() -> Result<McpClientStore, String> {
  let path = mcp_clients_path()?;
  if !path.exists() {
    return Ok(McpClientStore::default());
  }
  let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
  Ok(serde_json::from_str::<McpClientStore>(&content).unwrap_or_default())
}

fn save_mcp_store(store: &McpClientStore) -> Result<(), String> {
  let path = mcp_clients_path()?;
  let content = serde_json::to_string_pretty(store).map_err(|e| e.to_string())?;
  fs::write(path, content).map_err(|e| e.to_string())
}

fn http_client() -> Result<Client, String> {
  Client::builder()
    .timeout(Duration::from_secs(20))
    .build()
    .map_err(|e| e.to_string())
}

fn merged_headers(client: &McpClientConfig) -> Result<HeaderMap, String> {
  let mut map = HeaderMap::new();
  map.insert(ACCEPT, HeaderValue::from_static("application/json, text/event-stream"));
  map.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));

  for h in &client.headers {
    let key = h.key.trim();
    if key.is_empty() {
      continue;
    }
    let value = h.value.trim();
    let name = HeaderName::from_bytes(key.as_bytes())
      .map_err(|_| format!("无效 Header 名称: {}", key))?;
    let val =
      HeaderValue::from_str(value).map_err(|_| format!("无效 Header 值: {}", key))?;
    map.insert(name, val);
  }

  if !client.bearer_token.trim().is_empty() {
    let auth = format!("Bearer {}", client.bearer_token.trim());
    let auth_val = HeaderValue::from_str(&auth).map_err(|_| "无效 Bearer Token".to_string())?;
    map.insert(AUTHORIZATION, auth_val);
  }

  Ok(map)
}

fn summarize_http_error(status: reqwest::StatusCode, body: &str) -> String {
  if let Ok(v) = serde_json::from_str::<Value>(body) {
    if let Some(msg) = v
      .get("error")
      .and_then(|x| x.get("message"))
      .and_then(|x| x.as_str())
    {
      return format!("HTTP {} — {}", status, msg);
    }
    if let Some(msg) = v.get("message").and_then(|x| x.as_str()) {
      return format!("HTTP {} — {}", status, msg);
    }
  }
  let trimmed: String = body.chars().take(300).collect();
  if trimmed.is_empty() {
    format!("HTTP {}", status)
  } else {
    format!("HTTP {} — {}", status, trimmed)
  }
}

fn rpc_post(client: &McpClientConfig, body: &Value) -> Result<Value, String> {
  let http = http_client()?;
  let headers = merged_headers(client)?;
  let res = http
    .post(client.url.trim())
    .headers(headers)
    .json(body)
    .send()
    .map_err(|e| format!("连接失败: {}", e))?;
  let status = res.status();
  let text = res.text().map_err(|e| e.to_string())?;
  if !status.is_success() {
    return Err(summarize_http_error(status, &text));
  }
  if text.trim().is_empty() {
    return Ok(json!({}));
  }
  serde_json::from_str::<Value>(&text).map_err(|e| format!("响应不是合法 JSON: {}", e))
}

fn rpc_initialize(client: &McpClientConfig) -> Result<(), String> {
  let init_body = json!({
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2024-11-05",
      "capabilities": {},
      "clientInfo": {
        "name": "Tental",
        "version": "0.1.0"
      }
    }
  });
  let init_res = rpc_post(client, &init_body)?;
  if init_res.get("error").is_some() {
    return Err(format!(
      "MCP initialize 失败: {}",
      init_res
        .get("error")
        .and_then(|x| x.get("message"))
        .and_then(|x| x.as_str())
        .unwrap_or("unknown error")
    ));
  }

  let notify_body = json!({
    "jsonrpc": "2.0",
    "method": "notifications/initialized",
    "params": {}
  });
  let _ = rpc_post(client, &notify_body);
  Ok(())
}

fn find_client(id: &str) -> Result<McpClientConfig, String> {
  let store = load_mcp_store()?;
  store
    .clients
    .into_iter()
    .find(|c| c.id == id)
    .ok_or_else(|| format!("找不到 MCP 客户端: {}", id))
}

pub fn list_mcp_clients() -> Result<Vec<McpClientConfig>, String> {
  let mut store = load_mcp_store()?;
  store.clients.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
  Ok(store.clients)
}

pub fn save_mcp_client(req: SaveMcpClientRequest) -> Result<McpClientConfig, String> {
  let name = req.name.trim().to_string();
  if name.is_empty() {
    return Err("名称不能为空".to_string());
  }
  let url = req.url.trim().to_string();
  validate_http_url(&url)?;

  let now = now_ms();
  let mut store = load_mcp_store()?;
  let headers = normalize_headers(&req.headers);
  let token = req.bearer_token.trim().to_string();

  if let Some(id) = req.id {
    if let Some(idx) = store.clients.iter().position(|x| x.id == id) {
      store.clients[idx].name = name;
      store.clients[idx].url = url;
      store.clients[idx].headers = headers;
      store.clients[idx].bearer_token = token;
      store.clients[idx].enabled = req.enabled;
      store.clients[idx].updated_at = now;
      let updated = store.clients[idx].clone();
      save_mcp_store(&store)?;
      return Ok(updated);
    }
    return Err("更新失败：客户端不存在".to_string());
  }

  let created = McpClientConfig {
    id: new_client_id(),
    name,
    transport: "streamable_http".to_string(),
    url,
    headers,
    bearer_token: token,
    enabled: req.enabled,
    created_at: now,
    updated_at: now,
  };
  store.clients.push(created.clone());
  save_mcp_store(&store)?;
  Ok(created)
}

pub fn delete_mcp_client(id: &str) -> Result<(), String> {
  let mut store = load_mcp_store()?;
  let before = store.clients.len();
  store.clients.retain(|x| x.id != id);
  if store.clients.len() == before {
    return Err("删除失败：客户端不存在".to_string());
  }
  save_mcp_store(&store)
}

pub fn set_mcp_client_enabled(id: &str, enabled: bool) -> Result<(), String> {
  let mut store = load_mcp_store()?;
  let now = now_ms();
  let mut found = false;
  for item in &mut store.clients {
    if item.id == id {
      item.enabled = enabled;
      item.updated_at = now;
      found = true;
      break;
    }
  }
  if !found {
    return Err("设置失败：客户端不存在".to_string());
  }
  save_mcp_store(&store)
}

pub fn test_mcp_client(id: &str) -> Result<McpConnectionTestResult, String> {
  let client = find_client(id)?;
  validate_http_url(&client.url)?;
  rpc_initialize(&client)?;
  Ok(McpConnectionTestResult {
    ok: true,
    message: "连接成功（initialize 完成）".to_string(),
  })
}

pub fn list_mcp_client_tools(id: &str) -> Result<Vec<McpToolMeta>, String> {
  let client = find_client(id)?;
  validate_http_url(&client.url)?;
  rpc_initialize(&client)?;

  let list_body = json!({
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/list",
    "params": {}
  });
  let v = rpc_post(&client, &list_body)?;
  if let Some(err) = v.get("error") {
    let msg = err
      .get("message")
      .and_then(|x| x.as_str())
      .unwrap_or("unknown error");
    return Err(format!("MCP tools/list 失败: {}", msg));
  }
  let tools = v
    .get("result")
    .and_then(|x| x.get("tools"))
    .and_then(|x| x.as_array())
    .cloned()
    .unwrap_or_default();
  let mapped = tools
    .into_iter()
    .map(|item| McpToolMeta {
      name: item
        .get("name")
        .and_then(|x| x.as_str())
        .unwrap_or_default()
        .to_string(),
      description: item
        .get("description")
        .and_then(|x| x.as_str())
        .unwrap_or_default()
        .to_string(),
    })
    .filter(|t| !t.name.trim().is_empty())
    .collect();
  Ok(mapped)
}
