mod chat_store;
mod llm;
mod mcp;
mod skills;
mod tools;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::PathBuf;

pub use chat_store::{ChatMessage, ChatSession, ChatStore};
pub use tools::{ToolMeta, ToolSecurityConfig};

fn default_chat_ui_skin() -> String {
  "default".to_string()
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct AppConfig {
  theme: String,
  language: String,
  agent: AgentConfig,
  #[serde(default = "default_chat_ui_skin")]
  chat_ui_skin: String,
  #[serde(default)]
  chat_ui_persona_enabled: bool,
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
      chat_ui_skin: "default".to_string(),
      chat_ui_persona_enabled: false,
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

#[tauri::command]
fn load_blacklist() -> Result<Vec<String>, String> {
  tools::load_blacklist()
}

#[tauri::command]
fn save_blacklist(list: Vec<String>) -> Result<(), String> {
  tools::save_blacklist(&list)
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

#[tauri::command]
fn list_mcp_clients() -> Result<Vec<mcp::McpClientConfig>, String> {
  mcp::list_mcp_clients()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveMcpClientCmdRequest {
  id: Option<String>,
  name: String,
  url: String,
  #[serde(default)]
  headers: Vec<mcp::McpHeader>,
  #[serde(default)]
  bearer_token: String,
  enabled: bool,
}

#[tauri::command]
fn save_mcp_client(req: SaveMcpClientCmdRequest) -> Result<mcp::McpClientConfig, String> {
  mcp::save_mcp_client(mcp::SaveMcpClientRequest {
    id: req.id,
    name: req.name,
    url: req.url,
    headers: req.headers,
    bearer_token: req.bearer_token,
    enabled: req.enabled,
  })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeleteMcpClientRequest {
  id: String,
}

#[tauri::command]
fn delete_mcp_client(req: DeleteMcpClientRequest) -> Result<(), String> {
  mcp::delete_mcp_client(&req.id)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetMcpClientEnabledRequest {
  id: String,
  enabled: bool,
}

#[tauri::command]
fn set_mcp_client_enabled(req: SetMcpClientEnabledRequest) -> Result<(), String> {
  mcp::set_mcp_client_enabled(&req.id, req.enabled)
}

#[tauri::command]
fn test_mcp_client(req: DeleteMcpClientRequest) -> Result<mcp::McpConnectionTestResult, String> {
  mcp::test_mcp_client(&req.id)
}

#[tauri::command]
fn list_mcp_client_tools(req: DeleteMcpClientRequest) -> Result<Vec<mcp::McpToolMeta>, String> {
  mcp::list_mcp_client_tools(&req.id)
}

#[tauri::command]
fn list_skills() -> Result<Vec<skills::SkillMeta>, String> {
  skills::list_skills()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateSkillCmdRequest {
  name: String,
  content: String,
  #[serde(default)]
  config: serde_json::Value,
}

#[tauri::command]
fn create_skill(req: CreateSkillCmdRequest) -> Result<(), String> {
  skills::create_skill(skills::CreateSkillRequest {
    name: req.name,
    content: req.content,
    config: req.config,
  })
}

#[tauri::command]
fn get_skill_content(req: DeleteSkillRequest) -> Result<skills::SkillContentPayload, String> {
  skills::get_skill_content(&req.name)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveSkillContentRequest {
  name: String,
  content: String,
}

#[tauri::command]
fn save_skill_content(req: SaveSkillContentRequest) -> Result<(), String> {
  skills::save_skill_content(&req.name, &req.content)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetSkillEnabledRequest {
  name: String,
  enabled: bool,
}

#[tauri::command]
fn set_skill_enabled(req: SetSkillEnabledRequest) -> Result<(), String> {
  skills::set_skill_enabled(&req.name, req.enabled)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeleteSkillRequest {
  name: String,
}

#[tauri::command]
fn delete_skill(req: DeleteSkillRequest) -> Result<(), String> {
  skills::delete_skill(&req.name)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportSkillsZipRequest {
  zip_base64: String,
}

#[tauri::command]
fn import_skills_zip(req: ImportSkillsZipRequest) -> Result<skills::ImportSkillsZipResult, String> {
  skills::import_skills_zip_base64(&req.zip_base64)
}

#[tauri::command]
fn bootstrap_builtin_skills() -> Result<(), String> {
  skills::bootstrap_builtin_skills()
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

#[derive(Debug, Clone)]
enum ToolSource {
  Builtin,
  Mcp {
    client_id: String,
    remote_tool_name: String,
  },
}

#[derive(Debug, Clone)]
struct ToolRef {
  source: ToolSource,
}

fn redact_debug_value(v: &Value) -> Value {
  match v {
    Value::Object(map) => {
      let mut out = serde_json::Map::new();
      for (k, val) in map {
        let key_l = k.to_lowercase();
        if key_l.contains("token") || key_l.contains("authorization") || key_l.contains("api_key") {
          out.insert(k.clone(), Value::String("[REDACTED]".to_string()));
        } else {
          out.insert(k.clone(), redact_debug_value(val));
        }
      }
      Value::Object(out)
    }
    Value::Array(arr) => Value::Array(arr.iter().map(redact_debug_value).collect()),
    _ => v.clone(),
  }
}

fn normalize_error_code(code: Option<String>, message: Option<&str>) -> String {
  if let Some(c) = code {
    let c = c.trim().to_string();
    if !c.is_empty() {
      return c;
    }
  }
  let m = message.unwrap_or("").to_lowercase();
  if m.contains("timeout") || m.contains("timed out") {
    "mcp_timeout".to_string()
  } else if m.contains("auth") || m.contains("401") || m.contains("403") || m.contains("bearer") {
    "mcp_auth_failed".to_string()
  } else if m.contains("invalid") || m.contains("schema") {
    "invalid_input".to_string()
  } else {
    "tool_exec_failed".to_string()
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum IntentClass {
  ReadOnly,
  WriteOrOperate,
  General,
}

fn infer_intent_class(pairs: &[(String, String)]) -> IntentClass {
  let last_user = pairs
    .iter()
    .rev()
    .find(|(role, _)| role == "user")
    .map(|(_, c)| c.to_lowercase())
    .unwrap_or_default();
  if last_user.is_empty() {
    return IntentClass::General;
  }
  let write_keywords = [
    "创建", "新建", "生成", "修改", "编辑", "删除", "写入", "更新", "重命名", "move", "rename", "delete", "create",
    "write", "edit", "update", "remove", "install", "uninstall", "restart", "stop", "deploy",
  ];
  if write_keywords.iter().any(|k| last_user.contains(k)) {
    return IntentClass::WriteOrOperate;
  }
  let readonly_keywords = [
    "查询", "查", "统计", "汇总", "读取", "查看", "分析", "检索", "工时", "报表", "count", "query", "read", "list",
    "show", "analyze", "summary",
  ];
  if readonly_keywords.iter().any(|k| last_user.contains(k)) {
    return IntentClass::ReadOnly;
  }
  IntentClass::General
}

fn trust_guard_policy_lines() -> Vec<String> {
  vec![
    "可信执行约束：不得将假设写成事实；不得创建演示数据并冒充真实结果。".to_string(),
    "若缺少合适工具、数据源或权限，必须明确说明无法可靠完成，并请求补充必要信息。".to_string(),
    "当结论依赖工具执行时，输出需基于实际工具结果，不得伪造执行记录。".to_string(),
  ]
}

fn is_potential_write_operation(tool_name: &str, input: &serde_json::Value) -> bool {
  if tool_name == "write_file" || tool_name == "edit_file" {
    return true;
  }
  if tool_name != "bash" {
    return false;
  }
  let cmd = input
    .get("command")
    .and_then(|v| v.as_str())
    .unwrap_or("")
    .to_lowercase();
  if cmd.is_empty() {
    return false;
  }
  let write_patterns = [
    "set-content",
    "add-content",
    "out-file",
    "new-item",
    "remove-item",
    "rename-item",
    "move-item",
    "copy-item",
    "sc ",
    "git commit",
    "git push",
    "npm install",
    "cargo add",
    "pip install",
    ">",
    ">>",
  ];
  write_patterns.iter().any(|p| cmd.contains(p))
}

fn needs_strong_evidence(intent: IntentClass) -> bool {
  matches!(intent, IntentClass::ReadOnly)
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
  let intent_class = infer_intent_class(&pairs);
  let tool_list = tools::list_tools()?;
  let enabled_tools: Vec<ToolMeta> = tool_list.into_iter().filter(|t| t.enabled).collect();
  let mcp_tools = tokio::task::spawn_blocking(mcp::list_enabled_mcp_chat_tools)
    .await
    .map_err(|e| e.to_string())?
    .unwrap_or_else(|e| {
      log::warn!("[MCP][stream_chat] failed to list chat tools: {}", e);
      Vec::new()
    });

  let mut system_parts: Vec<String> = Vec::new();
  system_parts.push(if app_config.agent.language == "en" {
    "Respond in English.".to_string()
  } else {
    "请使用中文回复。".to_string()
  });
  system_parts.extend(trust_guard_policy_lines());
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

  let mut tool_refs: std::collections::HashMap<String, ToolRef> = std::collections::HashMap::new();
  let mut tool_defs: Vec<serde_json::Value> = enabled_tools
    .iter()
    .map(|t| {
      tool_refs.insert(
        t.id.clone(),
        ToolRef {
          source: ToolSource::Builtin,
        },
      );
      serde_json::json!({
        "name": t.id,
        "description": t.description,
        "input_schema": anthropic_tool_input_schema(&t.id)
      })
    })
    .collect();
  for mt in mcp_tools {
    let source = ToolSource::Mcp {
      client_id: mt.client_id.clone(),
      remote_tool_name: mt.remote_tool_name.clone(),
    };
    tool_refs.insert(
      mt.tool_name.clone(),
      ToolRef {
        source,
      },
    );
    tool_defs.push(serde_json::json!({
      "name": mt.tool_name,
      "description": mt.description,
      "input_schema": mt.input_schema
    }));
  }

  let max_loops = app_config.agent.max_iterations.max(1);
  let mut consecutive_tool_failures: Option<(String, String, usize)> = None;
  let mut has_verified_tool_evidence = false;
  let mut attempted_tool_calls = 0usize;
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
      let redacted_body = redact_debug_value(&body);
      channel
        .send(llm::StreamChatPayload::tool_event(
          "debug_trace",
          serde_json::json!({"stage":"messages_input","message": redacted_body}),
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
      let redacted_response = redact_debug_value(&response);
      channel
        .send(llm::StreamChatPayload::tool_event(
          "debug_trace",
          serde_json::json!({"stage":"messages_output","message": redacted_response}),
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
      let tool_ref = tool_refs.get(&name).cloned();
      let source_label = match &tool_ref {
        Some(ToolRef {
          source:
            ToolSource::Mcp {
              client_id,
              remote_tool_name,
            },
          ..
        }) => format!("mcp:{}:{}", client_id, remote_tool_name),
        Some(ToolRef {
          source: ToolSource::Builtin,
          ..
        }) => "builtin".to_string(),
        None => "unknown".to_string(),
      };
      channel
        .send(llm::StreamChatPayload::tool_event(
          "tool_call",
          serde_json::json!({"id": id, "name": name, "input": input, "source": source_label.clone()}),
        ))
        .map_err(|e| e.to_string())?;
      let input_print = serde_json::to_string(&input).unwrap_or_else(|_| "<serialize_failed>".to_string());
      log::info!(
        "[LLM][stream_chat][tool_call] id={} name={} input={}",
        id,
        name,
        input_print
      );
      attempted_tool_calls += 1;
      let res = if intent_class != IntentClass::WriteOrOperate && is_potential_write_operation(&name, &input) {
        tools::RunToolResponse {
          ok: false,
          name: name.clone(),
          output: serde_json::json!({}),
          error: Some("当前任务被识别为非修改类任务，已阻止潜在写操作。".to_string()),
          error_code: Some("policy_write_forbidden_non_write_intent".to_string()),
        }
      } else {
        let run_result = match &tool_ref {
          Some(ToolRef {
            source: ToolSource::Builtin,
            ..
          }) => tools::run_tool(&name, input.clone()),
          Some(ToolRef {
            source: ToolSource::Mcp { .. },
            ..
          }) => {
            let name_for_call = name.clone();
            let input_for_call = input.clone();
            tokio::task::spawn_blocking(move || mcp::run_mcp_chat_tool(&name_for_call, input_for_call))
              .await
              .map_err(|e| e.to_string())?
          }
          None => Ok(tools::RunToolResponse {
            ok: false,
            name: name.clone(),
            output: serde_json::json!({}),
            error: Some(format!("unknown tool: {}", name)),
            error_code: Some("unknown_tool".to_string()),
          }),
        };
        match run_result {
          Ok(v) => v,
          Err(e) => tools::RunToolResponse {
            ok: false,
            name: name.clone(),
            output: serde_json::json!({}),
            error: Some(e),
            error_code: Some("tool_exec_failed".to_string()),
          },
        }
      };
      let normalized_error_code = if res.ok {
        None
      } else {
        Some(normalize_error_code(res.error_code.clone(), res.error.as_deref()))
      };
      let payload = serde_json::json!({
        "id": id,
        "name": name,
        "ok": res.ok,
        "output": res.output,
        "error": res.error,
        "errorCode": normalized_error_code,
        "source": source_label,
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
        has_verified_tool_evidence = true;
        consecutive_tool_failures = None;
      } else {
        let err_code = normalized_error_code
          .clone()
          .unwrap_or_else(|| "tool_exec_failed".to_string());
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
      if needs_strong_evidence(intent_class) && attempted_tool_calls > 0 && !has_verified_tool_evidence {
        let fallback = if app_config.agent.language == "en" {
          "I cannot provide a reliable result yet because no valid tool evidence was obtained. Please provide an accessible data source or required permissions."
            .to_string()
        } else {
          "当前无法给出可靠结果：未获得有效工具证据。请提供可访问的数据源或必要权限后再查询。".to_string()
        };
        log::warn!(
          "[LLM][stream_chat][trust_guard] fallback_without_evidence intent={:?}",
          intent_class
        );
        channel
          .send(llm::StreamChatPayload::delta(None, Some(fallback)))
          .map_err(|e| e.to_string())?;
        channel.send(llm::StreamChatPayload::done()).map_err(|e| e.to_string())?;
        return Ok(());
      }
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
  use super::{infer_intent_class, is_potential_write_operation, windows_command_policy_lines, IntentClass};

  #[test]
  fn windows_policy_enforces_powershell_variables() {
    let joined = windows_command_policy_lines().join("\n");
    assert!(joined.contains("$env:VAR"));
    assert!(joined.contains("%VAR%"));
    assert!(joined.contains("PowerShell"));
  }

  #[test]
  fn intent_class_detects_readonly_and_write() {
    let read_pairs = vec![("user".to_string(), "查询用户工时汇总".to_string())];
    assert_eq!(infer_intent_class(&read_pairs), IntentClass::ReadOnly);

    let write_pairs = vec![("user".to_string(), "请修改这个文件内容".to_string())];
    assert_eq!(infer_intent_class(&write_pairs), IntentClass::WriteOrOperate);
  }

  #[test]
  fn write_operation_detection_for_bash_and_file_tools() {
    assert!(is_potential_write_operation("write_file", &serde_json::json!({})));
    assert!(is_potential_write_operation(
      "bash",
      &serde_json::json!({"command":"Set-Content -Path a.txt -Value 1"})
    ));
    assert!(!is_potential_write_operation(
      "bash",
      &serde_json::json!({"command":"Get-ChildItem -Force"})
    ));
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      // Seed blacklist.json on first app startup.
      let _ = tools::ensure_blacklist_seeded();
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
      load_blacklist,
      save_blacklist,
      run_tool,
      list_mcp_clients,
      save_mcp_client,
      delete_mcp_client,
      set_mcp_client_enabled,
      test_mcp_client,
      list_mcp_client_tools,
      list_skills,
      create_skill,
      get_skill_content,
      save_skill_content,
      set_skill_enabled,
      delete_skill,
      import_skills_zip,
      bootstrap_builtin_skills,
      complete_chat,
      stream_chat,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
