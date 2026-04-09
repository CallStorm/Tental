use crate::get_tental_dir_path;
use crate::tools;
use reqwest::blocking::Client;
use reqwest::header::{
  ACCEPT, AUTHORIZATION, CONTENT_TYPE, HeaderMap, HeaderName, HeaderValue,
};
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
  #[serde(default)]
  pub input_schema: Value,
}

#[derive(Debug, Clone)]
pub struct ChatMcpToolDef {
  pub tool_name: String,
  pub description: String,
  pub input_schema: Value,
  pub client_id: String,
  pub remote_tool_name: String,
}

pub fn encode_chat_mcp_tool_name(client_id: &str, remote_tool_name: &str) -> String {
  let normalized_client = client_id.trim().replace("__", "_");
  let normalized_remote = remote_tool_name.trim().replace("__", "_");
  format!("mcp__{}__{}", normalized_client, normalized_remote)
}

pub fn decode_chat_mcp_tool_name(tool_name: &str) -> Option<(String, String)> {
  let prefix = "mcp__";
  if !tool_name.starts_with(prefix) {
    return None;
  }
  let rest = &tool_name[prefix.len()..];
  let mut parts = rest.splitn(2, "__");
  let client_id = parts.next()?.trim();
  let remote_tool_name = parts.next()?.trim();
  if client_id.is_empty() || remote_tool_name.is_empty() {
    return None;
  }
  Some((client_id.to_string(), remote_tool_name.to_string()))
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

fn map_mcp_error_code(msg: &str) -> String {
  let m = msg.to_lowercase();
  if m.contains("timed out") || m.contains("timeout") {
    "mcp_timeout".to_string()
  } else if m.contains("401") || m.contains("403") || m.contains("bearer") || m.contains("auth") {
    "mcp_auth_failed".to_string()
  } else if m.contains("unknown tool") || m.contains("tools/call 失败") {
    "unknown_tool".to_string()
  } else {
    "mcp_server_error".to_string()
  }
}

fn parse_json_from_response_text(text: &str) -> Result<Value, String> {
  let trimmed = text.trim();
  if trimmed.is_empty() {
    return Ok(json!({}));
  }

  if let Ok(v) = serde_json::from_str::<Value>(trimmed) {
    return Ok(v);
  }

  // Some streamable_http MCP servers reply as SSE:
  // event: message
  // data: {"jsonrpc":"2.0", ...}
  let mut sse_data_buf = String::new();
  for raw_line in trimmed.lines() {
    let line = raw_line.trim();
    if line.is_empty() {
      continue;
    }
    if let Some(data) = line.strip_prefix("data:") {
      let payload = data.trim();
      if payload.is_empty() || payload == "[DONE]" {
        continue;
      }
      if let Ok(v) = serde_json::from_str::<Value>(payload) {
        return Ok(v);
      }
      sse_data_buf.push_str(payload);
      sse_data_buf.push('\n');
      continue;
    }
    if let Ok(v) = serde_json::from_str::<Value>(line) {
      return Ok(v);
    }
  }

  if !sse_data_buf.trim().is_empty() {
    for chunk in sse_data_buf.lines() {
      let t = chunk.trim();
      if t.is_empty() {
        continue;
      }
      if let Ok(v) = serde_json::from_str::<Value>(t) {
        return Ok(v);
      }
    }
  }

  Err("响应不是合法 JSON（或 SSE data JSON）".to_string())
}

fn rpc_post(
  client: &McpClientConfig,
  body: &Value,
  session_id: Option<&str>,
) -> Result<(Value, Option<String>), String> {
  let http = http_client()?;
  let mut headers = merged_headers(client)?;
  if let Some(session) = session_id {
    let trimmed = session.trim();
    if !trimmed.is_empty() {
      let value =
        HeaderValue::from_str(trimmed).map_err(|_| "无效 MCP Session ID".to_string())?;
      headers.insert("mcp-session-id", value);
    }
  }
  let res = http
    .post(client.url.trim())
    .headers(headers)
    .json(body)
    .send()
    .map_err(|e| format!("连接失败: {}", e))?;
  let response_session_id = res
    .headers()
    .get("mcp-session-id")
    .and_then(|v| v.to_str().ok())
    .map(|s| s.to_string());
  let status = res.status();
  let text = res.text().map_err(|e| e.to_string())?;
  if !status.is_success() {
    return Err(summarize_http_error(status, &text));
  }
  let parsed = parse_json_from_response_text(&text)?;
  Ok((parsed, response_session_id))
}

fn rpc_initialize(client: &McpClientConfig) -> Result<(), String> {
  let mut session_id: Option<String> = None;
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
  let (init_res, init_session_id) = rpc_post(client, &init_body, session_id.as_deref())?;
  if init_session_id.is_some() {
    session_id = init_session_id;
  }
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
  let _ = rpc_post(client, &notify_body, session_id.as_deref());
  Ok(())
}

fn rpc_initialize_session(client: &McpClientConfig) -> Result<Option<String>, String> {
  let mut session_id: Option<String> = None;
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
  let (init_res, init_session_id) = rpc_post(client, &init_body, session_id.as_deref())?;
  if init_session_id.is_some() {
    session_id = init_session_id;
  }
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
  let _ = rpc_post(client, &notify_body, session_id.as_deref());
  Ok(session_id)
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
  let session_id = rpc_initialize_session(&client)?;

  let list_body = json!({
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/list",
    "params": {}
  });
  let (v, _) = rpc_post(&client, &list_body, session_id.as_deref())?;
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
      input_schema: item
        .get("inputSchema")
        .cloned()
        .or_else(|| item.get("input_schema").cloned())
        .unwrap_or_else(|| json!({"type":"object","additionalProperties":true})),
    })
    .filter(|t| !t.name.trim().is_empty())
    .collect();
  Ok(mapped)
}

pub fn list_enabled_mcp_chat_tools() -> Result<Vec<ChatMcpToolDef>, String> {
  let clients = list_mcp_clients()?;
  let mut out: Vec<ChatMcpToolDef> = Vec::new();
  for client in clients.into_iter().filter(|c| c.enabled) {
    match list_mcp_client_tools(&client.id) {
      Ok(tools) => {
        for t in tools {
          let name = t.name.trim();
          if name.is_empty() {
            continue;
          }
          out.push(ChatMcpToolDef {
            tool_name: encode_chat_mcp_tool_name(&client.id, name),
            description: if t.description.trim().is_empty() {
              format!("MCP tool from client {}", client.name)
            } else {
              t.description.clone()
            },
            input_schema: t.input_schema,
            client_id: client.id.clone(),
            remote_tool_name: name.to_string(),
          });
        }
      }
      Err(e) => {
        log::warn!("[MCP][chat_tools] skip client={} reason={}", client.id, e);
      }
    }
  }
  Ok(out)
}

pub fn run_mcp_chat_tool(tool_name: &str, input: Value) -> Result<tools::RunToolResponse, String> {
  let (client_id, remote_tool_name) =
    decode_chat_mcp_tool_name(tool_name).ok_or_else(|| format!("unknown tool: {}", tool_name))?;
  let client = find_client(&client_id)?;
  if !client.enabled {
    return Ok(tools::RunToolResponse {
      ok: false,
      name: tool_name.to_string(),
      output: json!({}),
      error: Some("MCP 客户端未启用".to_string()),
      error_code: Some("tool_exec_failed".to_string()),
    });
  }
  validate_http_url(&client.url)?;
  let session_id = rpc_initialize_session(&client)?;
  let call_body = json!({
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": {
      "name": remote_tool_name,
      "arguments": input
    }
  });
  let call = rpc_post(&client, &call_body, session_id.as_deref());
  match call {
    Ok((v, _)) => {
      if let Some(err) = v.get("error") {
        let msg = err
          .get("message")
          .and_then(|x| x.as_str())
          .unwrap_or("unknown error")
          .to_string();
        return Ok(tools::RunToolResponse {
          ok: false,
          name: tool_name.to_string(),
          output: json!({}),
          error: Some(format!("MCP tools/call 失败: {}", msg)),
          error_code: Some(map_mcp_error_code(&msg)),
        });
      }
      let result = v.get("result").cloned().unwrap_or_else(|| json!({}));
      Ok(tools::RunToolResponse {
        ok: true,
        name: tool_name.to_string(),
        output: result,
        error: None,
        error_code: None,
      })
    }
    Err(e) => Ok(tools::RunToolResponse {
      ok: false,
      name: tool_name.to_string(),
      output: json!({}),
      error: Some(e.clone()),
      error_code: Some(map_mcp_error_code(&e)),
    }),
  }
}
