use crate::ModelProvider;
use serde::Serialize;
use serde_json::{json, Value};
use std::time::Duration;

/// Event pushed to the frontend stream (camelCase JSON).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamChatPayload {
  pub event: String,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub thinking_delta: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub content_delta: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub message: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub tool: Option<Value>,
}

impl StreamChatPayload {
  pub fn delta(thinking: Option<String>, content: Option<String>) -> Self {
    Self {
      event: "delta".to_string(),
      thinking_delta: thinking,
      content_delta: content,
      message: None,
      tool: None,
    }
  }

  pub fn done() -> Self {
    Self {
      event: "done".to_string(),
      thinking_delta: None,
      content_delta: None,
      message: None,
      tool: None,
    }
  }

  pub fn error(message: String) -> Self {
    Self {
      event: "error".to_string(),
      thinking_delta: None,
      content_delta: None,
      message: Some(message),
      tool: None,
    }
  }

  pub fn tool_event(event: &str, tool: Value) -> Self {
    Self {
      event: event.to_string(),
      thinking_delta: None,
      content_delta: None,
      message: None,
      tool: Some(tool),
    }
  }
}

pub const TINY_PNG_B64: &str =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

pub fn http_client() -> Result<reqwest::blocking::Client, String> {
  reqwest::blocking::Client::builder()
    .timeout(Duration::from_secs(120))
    .build()
    .map_err(|e| e.to_string())
}

pub fn summarize_api_error(status: reqwest::StatusCode, body: &str) -> String {
  if let Ok(v) = serde_json::from_str::<Value>(body) {
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

fn extract_anthropic_reply_full(text: &str) -> Option<String> {
  let v: Value = serde_json::from_str(text).ok()?;
  let content = v.get("content")?.as_array()?;
  let mut parts: Vec<&str> = Vec::new();
  for block in content {
    if let Some(t) = block.get("text").and_then(|x| x.as_str()) {
      let s = t.trim();
      if !s.is_empty() {
        parts.push(s);
      }
    }
  }
  if parts.is_empty() {
    None
  } else {
    Some(parts.join("\n"))
  }
}

/// First 120 chars for test/snippet display.
pub fn extract_anthropic_reply_snippet(text: &str) -> Option<String> {
  extract_anthropic_reply_full(text).map(|s| s.chars().take(120).collect())
}

fn split_system_and_rest(messages: &[(String, String)]) -> (Option<String>, Vec<(String, String)>) {
  let mut system_parts: Vec<String> = Vec::new();
  let mut rest: Vec<(String, String)> = Vec::new();
  for (role, content) in messages {
    if role == "system" {
      let c = content.trim();
      if !c.is_empty() {
        system_parts.push(c.to_string());
      }
    } else if role == "user" || role == "assistant" {
      rest.push((role.clone(), content.clone()));
    }
  }
  let system = if system_parts.is_empty() {
    None
  } else {
    Some(system_parts.join("\n"))
  };
  (system, rest)
}

pub fn complete_chat(provider: &ModelProvider, messages: &[(String, String)]) -> Result<String, String> {
  let key = provider.api_key.trim();
  if key.is_empty() {
    return Err("请填写 API 密钥（设置 → 模型）".to_string());
  }

  match provider.provider_type.as_str() {
    "minimax_cn" => complete_anthropic_messages(provider, messages),
    other => Err(format!("未知供应商类型: {}", other)),
  }
}

pub fn anthropic_messages_create(provider: &ModelProvider, body: &Value) -> Result<Value, String> {
  let client = http_client()?;
  let key = provider.api_key.trim();
  let url = format!(
    "{}/v1/messages",
    provider.base_url.trim_end_matches('/')
  );
  let res = client
    .post(&url)
    .header("x-api-key", key)
    .header("anthropic-version", "2023-06-01")
    .header("content-type", "application/json")
    .json(body)
    .send()
    .map_err(|e| e.to_string())?;
  let status = res.status();
  let text = res.text().map_err(|e| e.to_string())?;
  if !status.is_success() {
    return Err(summarize_api_error(status, &text));
  }
  serde_json::from_str::<Value>(&text).map_err(|e| format!("无法解析模型回复 JSON: {}", e))
}

fn complete_anthropic_messages(provider: &ModelProvider, messages: &[(String, String)]) -> Result<String, String> {
  let (system_opt, rest) = split_system_and_rest(messages);
  let anthropic_messages: Vec<Value> = rest
    .iter()
    .map(|(role, content)| {
      json!({
        "role": role,
        "content": content
      })
    })
    .collect();
  let mut body = json!({
    "model": provider.model,
    "max_tokens": 4096,
    "messages": anthropic_messages
  });
  if let Some(s) = system_opt {
    body
      .as_object_mut()
      .unwrap()
      .insert("system".to_string(), Value::String(s));
  }
  let v = anthropic_messages_create(provider, &body)?;
  extract_anthropic_reply_full(&v.to_string()).ok_or_else(|| "无法解析模型回复".to_string())
}

pub struct TestModelInput<'a> {
  pub provider_type: &'a str,
  pub base_url: &'a str,
  pub api_key: &'a str,
  pub model: &'a str,
  pub test_kind: &'a str,
}

pub fn run_test_model_endpoint(input: TestModelInput<'_>) -> Result<String, String> {
  let client = http_client()?;
  let key = input.api_key.trim();
  if key.is_empty() {
    return Err("请填写 API 密钥".to_string());
  }

  match input.provider_type {
    "minimax_cn" => {
      let url = format!(
        "{}/v1/messages",
        input.base_url.trim_end_matches('/')
      );
      let body = if input.test_kind == "multimodal" {
        json!({
          "model": input.model,
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
          "model": input.model,
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
      let snippet =
        extract_anthropic_reply_snippet(&text).unwrap_or_else(|| "OK".to_string());
      Ok(format!("成功：{}", snippet))
    }
    other => Err(format!("未知供应商类型: {}", other)),
  }
}
