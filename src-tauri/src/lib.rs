mod chat_store;
mod llm;
mod tools;

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

pub use chat_store::{ChatMessage, ChatSession, ChatStore};
pub use tools::{ToolMeta, ToolSecurityConfig};

#[derive(Debug, Serialize, Deserialize)]
#[serde(default)]
struct AppConfig {
  theme: String,
  language: String,
  agent: AgentConfig,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(default, rename_all = "camelCase")]
struct AgentConfig {
  language: String,
  max_iterations: usize,
  max_context_tokens: usize,
  auto_retry_enabled: bool,
  max_retry_count: usize,
}

impl Default for AppConfig {
  fn default() -> Self {
    Self {
      theme: "system".to_string(),
      language: "zh".to_string(),
      agent: AgentConfig::default(),
    }
  }
}

impl Default for AgentConfig {
  fn default() -> Self {
    Self {
      language: "zh".to_string(),
      max_iterations: 6,
      max_context_tokens: 12_000,
      auto_retry_enabled: true,
      max_retry_count: 2,
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

#[tauri::command]
fn list_tools() -> Result<Vec<ToolMeta>, String> {
  tools::list_tools()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetToolEnabledRequest {
  tool_id: String,
  enabled: bool,
}

#[tauri::command]
fn set_tool_enabled(req: SetToolEnabledRequest) -> Result<(), String> {
  tools::set_tool_enabled(&req.tool_id, req.enabled)
}

#[tauri::command]
fn load_tool_security() -> Result<ToolSecurityConfig, String> {
  tools::load_security_config()
}

#[tauri::command]
fn save_tool_security(config: ToolSecurityConfig) -> Result<(), String> {
  tools::save_security_config(&config)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RunToolRequest {
  name: String,
  input: serde_json::Value,
}

#[tauri::command]
fn run_tool(req: RunToolRequest) -> Result<tools::RunToolResponse, String> {
  tools::run_tool(&req.name, req.input)
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StreamChatRequest {
  provider_id: Option<String>,
  messages: Vec<ChatTurn>,
  #[serde(default)]
  debug: bool,
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

fn anthropic_tool_input_schema(tool_id: &str) -> serde_json::Value {
  match tool_id {
    "bash" => serde_json::json!({
      "type": "object",
      "properties": {
        "command": { "type": "string", "description": "Command to execute." },
        "cwd": { "type": "string", "description": "Working directory (optional)." },
        "timeoutMs": { "type": "integer", "minimum": 1, "description": "Timeout in milliseconds (optional)." }
      },
      "required": ["command"],
      "additionalProperties": false
    }),
    "read_file" => serde_json::json!({
      "type": "object",
      "properties": {
        "path": { "type": "string", "description": "Absolute or relative file path." },
        "startLine": { "type": "integer", "minimum": 1, "description": "1-based start line (optional)." },
        "maxLines": { "type": "integer", "minimum": 1, "description": "Maximum lines to return (optional)." }
      },
      "required": ["path"],
      "additionalProperties": false
    }),
    "write_file" => serde_json::json!({
      "type": "object",
      "properties": {
        "path": { "type": "string", "description": "Absolute or relative file path." },
        "content": { "type": "string", "description": "Full file content to write." }
      },
      "required": ["path", "content"],
      "additionalProperties": false
    }),
    "edit_file" => serde_json::json!({
      "type": "object",
      "properties": {
        "path": { "type": "string", "description": "Absolute or relative file path." },
        "find": { "type": "string", "description": "String to find." },
        "replace": { "type": "string", "description": "Replacement string." },
        "all": { "type": "boolean", "description": "Replace all matches if true, otherwise first match." }
      },
      "required": ["path", "find", "replace"],
      "additionalProperties": false
    }),
    "get_current_time" => serde_json::json!({
      "type": "object",
      "properties": {},
      "additionalProperties": false
    }),
    _ => serde_json::json!({
      "type": "object",
      "properties": {},
      "additionalProperties": true
    }),
  }
}

fn estimate_tokens(content: &str) -> usize {
  // Lightweight estimate: mixed CJK/ASCII average around 2 chars/token.
  let chars = content.chars().count();
  (chars / 2).max(1)
}

fn windows_command_policy_lines() -> Vec<String> {
  vec![
    "Windows command policy: generate PowerShell syntax only. Never use cmd variable style like %VAR%; use $env:VAR."
      .to_string(),
    "For desktop file listing, use: $desktop=[Environment]::GetFolderPath('Desktop'); Get-ChildItem -Force $desktop | Select-Object -ExpandProperty Name"
      .to_string(),
  ]
}

fn trim_turns_for_context(pairs: &[(String, String)], max_context_tokens: usize) -> Vec<(String, String)> {
  if pairs.is_empty() {
    return vec![];
  }
  let mut system_turns: Vec<(String, String)> = Vec::new();
  let mut others: Vec<(String, String)> = Vec::new();
  for (r, c) in pairs {
    if r == "system" {
      system_turns.push((r.clone(), c.clone()));
    } else {
      others.push((r.clone(), c.clone()));
    }
  }

  let mut out = system_turns;
  let used = out
    .iter()
    .map(|(_, c)| estimate_tokens(c))
    .sum::<usize>();
  let budget = max_context_tokens.max(1000);
  if used >= budget {
    return out;
  }
  let mut remain = budget - used;
  let mut kept_rev: Vec<(String, String)> = Vec::new();
  for (r, c) in others.into_iter().rev() {
    let t = estimate_tokens(&c);
    if t <= remain || kept_rev.is_empty() {
      remain = remain.saturating_sub(t);
      kept_rev.push((r, c));
    } else {
      break;
    }
  }
  kept_rev.reverse();
  out.extend(kept_rev);
  out
}

fn call_complete_with_retry(
  provider: &ModelProvider,
  messages: &[(String, String)],
  cfg: &AgentConfig,
) -> Result<String, String> {
  let mut attempts = 0usize;
  let max_tries = if cfg.auto_retry_enabled {
    cfg.max_retry_count.saturating_add(1)
  } else {
    1
  };
  loop {
    let printable = serde_json::to_string_pretty(messages).unwrap_or_else(|_| "<serialize_failed>".to_string());
    log::info!("[LLM][complete_chat][request] {}", printable);
    match llm::complete_chat(provider, messages) {
      Ok(v) => {
        log::info!("[LLM][complete_chat][response] {}", v);
        return Ok(v);
      }
      Err(e) => {
        log::error!("[LLM][complete_chat][error] {}", e);
        attempts += 1;
        if attempts >= max_tries {
          return Err(e);
        }
      }
    }
  }
}

#[tauri::command]
fn complete_chat(req: CompleteChatRequest) -> Result<String, String> {
  let app_config = load_config()?;
  let model_config = load_model_config()?;
  let provider = resolve_provider(&model_config, req.provider_id.as_deref())?;
  let pairs: Vec<(String, String)> = req
    .messages
    .into_iter()
    .map(|m| (m.role, m.content))
    .collect();
  let trimmed = trim_turns_for_context(&pairs, app_config.agent.max_context_tokens);
  let printable = serde_json::to_string_pretty(&trimmed).unwrap_or_else(|_| "<serialize_failed>".to_string());
  log::info!("[LLM][complete_chat_cmd][trimmed_messages] {}", printable);
  call_complete_with_retry(provider, &trimmed, &app_config.agent)
}

#[tauri::command]
async fn stream_chat(
  req: StreamChatRequest,
  channel: tauri::ipc::Channel<llm::StreamChatPayload>,
) -> Result<(), String> {
  let app_config = load_config()?;
  let model_config = load_model_config()?;
  let provider = resolve_provider(&model_config, req.provider_id.as_deref())?.clone();
  let pairs: Vec<(String, String)> = req
    .messages
    .into_iter()
    .map(|m| (m.role, m.content))
    .collect();
  let tool_list = tools::list_tools()?;
  let enabled_tools: Vec<ToolMeta> = tool_list.into_iter().filter(|t| t.enabled).collect();

  let mut system_parts: Vec<String> = Vec::new();
  system_parts.push(if app_config.agent.language == "en" {
    "Respond in English.".to_string()
  } else {
    "请使用中文回复。".to_string()
  });
  if cfg!(windows) {
    system_parts.extend(windows_command_policy_lines());
  }
  let mut anthropic_messages: Vec<serde_json::Value> = Vec::new();
  for (role, content) in trim_turns_for_context(&pairs, app_config.agent.max_context_tokens) {
    let c = content.trim();
    if c.is_empty() {
      continue;
    }
    if role == "system" {
      system_parts.push(c.to_string());
      continue;
    }
    if role != "user" && role != "assistant" {
      continue;
    }
    anthropic_messages.push(serde_json::json!({
      "role": role,
      "content": [{"type":"text","text": c}]
    }));
  }

  let tool_defs: Vec<serde_json::Value> = enabled_tools
    .iter()
    .map(|t| {
      serde_json::json!({
        "name": t.id,
        "description": t.description,
        "input_schema": anthropic_tool_input_schema(&t.id)
      })
    })
    .collect();

  let max_loops = app_config.agent.max_iterations.max(1);
  let mut consecutive_tool_failures: Option<(String, String, usize)> = None;
  for loop_idx in 0..max_loops {
    let body = serde_json::json!({
      "model": provider.model,
      "max_tokens": 4096,
      "system": system_parts.join("\n"),
      "tools": tool_defs,
      "messages": anthropic_messages,
    });
    let body_print = serde_json::to_string_pretty(&body).unwrap_or_else(|_| "<serialize_failed>".to_string());
    log::info!(
      "[LLM][stream_chat][loop:{}][request_messages] {}",
      loop_idx + 1,
      body_print
    );
    if req.debug {
      channel
        .send(llm::StreamChatPayload::tool_event(
          "debug_trace",
          serde_json::json!({"stage":"messages_input","message": body}),
        ))
        .map_err(|e| e.to_string())?;
    }

    let provider_for_call = provider.clone();
    let body_for_call = body.clone();
    let response = tokio::task::spawn_blocking(move || llm::anthropic_messages_create(&provider_for_call, &body_for_call))
      .await
      .map_err(|e| e.to_string())??;
    let response_print =
      serde_json::to_string_pretty(&response).unwrap_or_else(|_| "<serialize_failed>".to_string());
    log::info!(
      "[LLM][stream_chat][loop:{}][response] {}",
      loop_idx + 1,
      response_print
    );
    if req.debug {
      channel
        .send(llm::StreamChatPayload::tool_event(
          "debug_trace",
          serde_json::json!({"stage":"messages_output","message": response}),
        ))
        .map_err(|e| e.to_string())?;
    }

    let blocks = response
      .get("content")
      .and_then(|x| x.as_array())
      .cloned()
      .unwrap_or_default();
    anthropic_messages.push(serde_json::json!({
      "role":"assistant",
      "content": blocks.clone()
    }));

    let mut tool_results: Vec<serde_json::Value> = Vec::new();
    for block in &blocks {
      if block.get("type").and_then(|v| v.as_str()) != Some("tool_use") {
        continue;
      }
      let id = block
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap_or("toolcall")
        .to_string();
      let name = block
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown")
        .to_string();
      let input = block
        .get("input")
        .cloned()
        .unwrap_or_else(|| serde_json::json!({}));
      channel
        .send(llm::StreamChatPayload::tool_event(
          "tool_call",
          serde_json::json!({"id": id, "name": name, "input": input}),
        ))
        .map_err(|e| e.to_string())?;
      let input_print = serde_json::to_string(&input).unwrap_or_else(|_| "<serialize_failed>".to_string());
      log::info!(
        "[LLM][stream_chat][tool_call] id={} name={} input={}",
        id,
        name,
        input_print
      );
      let res = match tools::run_tool(&name, input) {
        Ok(v) => v,
        Err(e) => tools::RunToolResponse {
          ok: false,
          name: name.clone(),
          output: serde_json::json!({}),
          error: Some(e),
          error_code: Some("tool_internal_error".to_string()),
        },
      };
      let payload = serde_json::json!({
        "id": id,
        "name": name,
        "ok": res.ok,
        "output": res.output,
        "error": res.error,
        "errorCode": res.error_code,
      });
      channel
        .send(llm::StreamChatPayload::tool_event("tool_result", payload.clone()))
        .map_err(|e| e.to_string())?;
      let payload_print = serde_json::to_string(&payload).unwrap_or_else(|_| "<serialize_failed>".to_string());
      log::info!("[LLM][stream_chat][tool_result] {}", payload_print);
      tool_results.push(serde_json::json!({
        "type":"tool_result",
        "tool_use_id": id,
        "content": payload.to_string()
      }));

      if res.ok {
        consecutive_tool_failures = None;
      } else {
        let err_code = res
          .error_code
          .clone()
          .unwrap_or_else(|| "non_zero_exit".to_string());
        let new_count = if let Some((prev_name, prev_code, count)) = &consecutive_tool_failures {
          if *prev_name == name && *prev_code == err_code {
            count + 1
          } else {
            1
          }
        } else {
          1
        };
        consecutive_tool_failures = Some((name.clone(), err_code.clone(), new_count));
        if new_count >= 2 {
          let fallback = if cfg!(windows) {
            "检测到同类命令连续失败，已停止自动重试。请改用 PowerShell 语法：$desktop=[Environment]::GetFolderPath('Desktop'); Get-ChildItem -Force $desktop | Select-Object -ExpandProperty Name"
          } else {
            "检测到同类命令连续失败，已停止自动重试。"
          };
          channel
            .send(llm::StreamChatPayload::error(format!(
              "tool repeated failure: name={}, errorCode={}",
              name, err_code
            )))
            .map_err(|e| e.to_string())?;
          channel
            .send(llm::StreamChatPayload::delta(None, Some(fallback.to_string())))
            .map_err(|e| e.to_string())?;
          channel.send(llm::StreamChatPayload::done()).map_err(|e| e.to_string())?;
          return Ok(());
        }
      }
    }

    if !tool_results.is_empty() {
      anthropic_messages.push(serde_json::json!({
        "role":"user",
        "content": tool_results
      }));
      continue;
    }

    let mut final_text = String::new();
    for block in &blocks {
      if block.get("type").and_then(|v| v.as_str()) == Some("text") {
        if let Some(t) = block.get("text").and_then(|v| v.as_str()) {
          final_text.push_str(t);
        }
      }
    }
    if !final_text.is_empty() {
      log::info!("[LLM][stream_chat][final_text] {}", final_text);
      channel
        .send(llm::StreamChatPayload::delta(None, Some(final_text)))
        .map_err(|e| e.to_string())?;
    }
    channel.send(llm::StreamChatPayload::done()).map_err(|e| e.to_string())?;
    return Ok(());
  }

  channel
    .send(llm::StreamChatPayload::error("tool loop exceeded max iterations".to_string()))
    .map_err(|e| e.to_string())?;
  channel.send(llm::StreamChatPayload::done()).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
  use super::windows_command_policy_lines;

  #[test]
  fn windows_policy_enforces_powershell_variables() {
    let joined = windows_command_policy_lines().join("\n");
    assert!(joined.contains("$env:VAR"));
    assert!(joined.contains("%VAR%"));
    assert!(joined.contains("PowerShell"));
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
      test_model_endpoint,
      load_chat_store,
      save_chat_store,
      list_tools,
      set_tool_enabled,
      load_tool_security,
      save_tool_security,
      run_tool,
      complete_chat,
      stream_chat,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
