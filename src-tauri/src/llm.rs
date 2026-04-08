use crate::ModelProvider;
use futures_util::StreamExt;
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
}

impl StreamChatPayload {
  fn delta(thinking: Option<String>, content: Option<String>) -> Self {
    Self {
      event: "delta".to_string(),
      thinking_delta: thinking,
      content_delta: content,
      message: None,
    }
  }

  fn done() -> Self {
    Self {
      event: "done".to_string(),
      thinking_delta: None,
      content_delta: None,
      message: None,
    }
  }

  fn error(message: String) -> Self {
    Self {
      event: "error".to_string(),
      thinking_delta: None,
      content_delta: None,
      message: Some(message),
    }
  }
}

#[derive(Default)]
struct SseLineBuf {
  buf: Vec<u8>,
}

impl SseLineBuf {
  /// Append chunk bytes; returns complete lines (without trailing `\n`, `\r` stripped).
  fn push(&mut self, chunk: &[u8]) -> Vec<String> {
    self.buf.extend_from_slice(chunk);
    let mut out = Vec::new();
    loop {
      let Some(pos) = self.buf.iter().position(|&b| b == b'\n') else {
        break;
      };
      let mut line: Vec<u8> = self.buf.drain(..=pos).collect();
      if line.last() == Some(&b'\n') {
        line.pop();
      }
      while line.last() == Some(&b'\r') {
        line.pop();
      }
      out.push(String::from_utf8_lossy(&line).into_owned());
    }
    out
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

fn extract_openai_reply_full(text: &str) -> Option<String> {
  let v: Value = serde_json::from_str(text).ok()?;
  let content = v
    .get("choices")?
    .get(0)?
    .get("message")?
    .get("content")?;
  match content {
    Value::String(s) => {
      let t = s.trim();
      if t.is_empty() {
        None
      } else {
        Some(t.to_string())
      }
    }
    _ => None,
  }
}

/// First 120 chars for test/snippet display.
pub fn extract_anthropic_reply_snippet(text: &str) -> Option<String> {
  extract_anthropic_reply_full(text).map(|s| s.chars().take(120).collect())
}

pub fn extract_openai_reply_snippet(text: &str) -> Option<String> {
  extract_openai_reply_full(text).map(|s| s.chars().take(120).collect())
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
    "deepseek" => complete_openai_chat(provider, messages),
    other => Err(format!("未知供应商类型: {}", other)),
  }
}

fn complete_openai_chat(provider: &ModelProvider, messages: &[(String, String)]) -> Result<String, String> {
  let client = http_client()?;
  let key = provider.api_key.trim();
  let base = provider.base_url.trim_end_matches('/');
  let url = format!("{}/v1/chat/completions", base);
  let openai_messages: Vec<Value> = messages
    .iter()
    .map(|(role, content)| {
      json!({
        "role": role,
        "content": content
      })
    })
    .collect();
  let body = json!({
    "model": provider.model,
    "max_tokens": 4096,
    "messages": openai_messages
  });
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
  extract_openai_reply_full(&text).ok_or_else(|| "无法解析模型回复".to_string())
}

fn complete_anthropic_messages(provider: &ModelProvider, messages: &[(String, String)]) -> Result<String, String> {
  let client = http_client()?;
  let key = provider.api_key.trim();
  let url = format!(
    "{}/v1/messages",
    provider.base_url.trim_end_matches('/')
  );
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
  extract_anthropic_reply_full(&text).ok_or_else(|| "无法解析模型回复".to_string())
}

fn http_client_async() -> Result<reqwest::Client, String> {
  reqwest::Client::builder()
    .timeout(Duration::from_secs(120))
    .build()
    .map_err(|e| e.to_string())
}

fn send_payload<F>(send: &F, p: StreamChatPayload) -> Result<(), String>
where
  F: Fn(StreamChatPayload) -> Result<(), String>,
{
  send(p)
}

fn parse_openai_sse_line(line: &str, send: &impl Fn(StreamChatPayload) -> Result<(), String>) -> Result<bool, String> {
  let line = line.trim();
  if line.is_empty() {
    return Ok(false);
  }
  let rest = line.strip_prefix("data:").map(|s| s.trim());
  let Some(data) = rest else {
    return Ok(false);
  };
  if data == "[DONE]" {
    return Ok(true);
  }
  let v: Value = match serde_json::from_str(data) {
    Ok(v) => v,
    Err(_) => return Ok(false),
  };
  if let Some(err) = v.get("error") {
    let msg = err
      .get("message")
      .and_then(|m| m.as_str())
      .unwrap_or("stream error");
    send_payload(send, StreamChatPayload::error(msg.to_string()))?;
    return Ok(true);
  }
  let choice0 = v.get("choices").and_then(|c| c.as_array()).and_then(|a| a.first());
  let Some(delta) = choice0.and_then(|c| c.get("delta")) else {
    return Ok(false);
  };
  let content = delta
    .get("content")
    .and_then(|x| x.as_str())
    .filter(|s| !s.is_empty())
    .map(|s| s.to_string());
  let thinking = delta
    .get("reasoning_content")
    .and_then(|x| x.as_str())
    .or_else(|| delta.get("reasoning").and_then(|x| x.as_str()))
    .filter(|s| !s.is_empty())
    .map(|s| s.to_string());
  if content.is_some() || thinking.is_some() {
    send_payload(send, StreamChatPayload::delta(thinking, content))?;
  }
  Ok(false)
}

pub async fn stream_openai_chat<F>(
  provider: &ModelProvider,
  messages: &[(String, String)],
  send: F,
) -> Result<(), String>
where
  F: Fn(StreamChatPayload) -> Result<(), String>,
{
  let client = http_client_async()?;
  let key = provider.api_key.trim();
  let base = provider.base_url.trim_end_matches('/');
  let url = format!("{}/v1/chat/completions", base);
  let openai_messages: Vec<Value> = messages
    .iter()
    .map(|(role, content)| {
      json!({
        "role": role,
        "content": content
      })
    })
    .collect();
  let body = json!({
    "model": provider.model,
    "max_tokens": 4096,
    "stream": true,
    "messages": openai_messages
  });
  let res = client
    .post(&url)
    .bearer_auth(key)
    .header("content-type", "application/json")
    .json(&body)
    .send()
    .await
    .map_err(|e| e.to_string())?;
  let status = res.status();
  if !status.is_success() {
    let text = res.text().await.map_err(|e| e.to_string())?;
    let err = summarize_api_error(status, &text);
    send_payload(&send, StreamChatPayload::error(err))?;
    send_payload(&send, StreamChatPayload::done())?;
    return Ok(());
  }
  let mut stream = res.bytes_stream();
  let mut line_buf = SseLineBuf::default();
  let mut stop = false;
  while let Some(item) = stream.next().await {
    let chunk = item.map_err(|e| e.to_string())?;
    for line in line_buf.push(&chunk) {
      if parse_openai_sse_line(&line, &send)? {
        stop = true;
        break;
      }
    }
    if stop {
      break;
    }
  }
  send_payload(&send, StreamChatPayload::done())?;
  Ok(())
}

fn handle_anthropic_stream_data(data: &str, send: &impl Fn(StreamChatPayload) -> Result<(), String>) -> Result<(), String> {
  let v: Value = match serde_json::from_str(data.trim()) {
    Ok(v) => v,
    Err(_) => return Ok(()),
  };
  if let Some(err) = v.get("error") {
    let msg = err
      .get("message")
      .and_then(|m| m.as_str())
      .unwrap_or("stream error");
    send_payload(send, StreamChatPayload::error(msg.to_string()))?;
    return Ok(());
  }
  let typ = v.get("type").and_then(|t| t.as_str());
  match typ {
    Some("content_block_delta") => {
      if let Some(delta) = v.get("delta") {
        let d_type = delta.get("type").and_then(|t| t.as_str());
        match d_type {
          Some("text_delta") => {
            let text = delta
              .get("text")
              .and_then(|x| x.as_str())
              .filter(|s| !s.is_empty());
            if let Some(t) = text {
              send_payload(
                send,
                StreamChatPayload::delta(None, Some(t.to_string())),
              )?;
            }
          }
          Some("thinking_delta") => {
            let thinking = delta
              .get("thinking")
              .and_then(|x| x.as_str())
              .or_else(|| delta.get("text").and_then(|x| x.as_str()))
              .filter(|s| !s.is_empty());
            if let Some(t) = thinking {
              send_payload(
                send,
                StreamChatPayload::delta(Some(t.to_string()), None),
              )?;
            }
          }
          _ => {}
        }
      }
    }
    Some("message_stop") => {}
    _ => {}
  }
  Ok(())
}

/// Anthropic-style SSE: optional `event:` lines plus `data:` JSON per event, blank line between events.
pub async fn stream_anthropic_messages<F>(
  provider: &ModelProvider,
  messages: &[(String, String)],
  send: F,
) -> Result<(), String>
where
  F: Fn(StreamChatPayload) -> Result<(), String>,
{
  let client = http_client_async()?;
  let key = provider.api_key.trim();
  let url = format!(
    "{}/v1/messages",
    provider.base_url.trim_end_matches('/')
  );
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
    "stream": true,
    "messages": anthropic_messages
  });
  if let Some(s) = system_opt {
    body
      .as_object_mut()
      .unwrap()
      .insert("system".to_string(), Value::String(s));
  }
  let res = client
    .post(&url)
    .header("x-api-key", key)
    .header("anthropic-version", "2023-06-01")
    .header("content-type", "application/json")
    .header("accept", "text/event-stream")
    .json(&body)
    .send()
    .await
    .map_err(|e| e.to_string())?;
  let status = res.status();
  if !status.is_success() {
    let text = res.text().await.map_err(|e| e.to_string())?;
    let err = summarize_api_error(status, &text);
    send_payload(&send, StreamChatPayload::error(err))?;
    send_payload(&send, StreamChatPayload::done())?;
    return Ok(());
  }
  let mut stream = res.bytes_stream();
  let mut line_buf = SseLineBuf::default();
  while let Some(item) = stream.next().await {
    let chunk = item.map_err(|e| e.to_string())?;
    for line in line_buf.push(&chunk) {
      let t = line.trim_end();
      if t.is_empty() || t.starts_with(':') {
        continue;
      }
      let Some(rest) = t.strip_prefix("data:") else {
        continue;
      };
      let data = rest.trim();
      if data == "[DONE]" {
        send_payload(&send, StreamChatPayload::done())?;
        return Ok(());
      }
      handle_anthropic_stream_data(data, &send)?;
    }
  }
  send_payload(&send, StreamChatPayload::done())?;
  Ok(())
}

pub async fn stream_chat<F>(provider: &ModelProvider, messages: &[(String, String)], send: F) -> Result<(), String>
where
  F: Fn(StreamChatPayload) -> Result<(), String>,
{
  let key = provider.api_key.trim();
  if key.is_empty() {
    return Err("请填写 API 密钥（设置 → 模型）".to_string());
  }
  match provider.provider_type.as_str() {
    "minimax_cn" => stream_anthropic_messages(provider, messages, send).await,
    "deepseek" => stream_openai_chat(provider, messages, send).await,
    other => Err(format!("未知供应商类型: {}", other)),
  }
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
    "deepseek" => {
      let base = input.base_url.trim_end_matches('/');
      let url = format!("{}/v1/chat/completions", base);

      let body = if input.test_kind == "multimodal" {
        json!({
          "model": input.model,
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
          "model": input.model,
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
      let snippet = extract_openai_reply_snippet(&text).unwrap_or_else(|| "OK".to_string());
      Ok(format!("成功：{}", snippet))
    }
    other => Err(format!("未知供应商类型: {}", other)),
  }
}
