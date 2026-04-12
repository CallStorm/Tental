use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::io::{Read, Write};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use crate::mcp;
use crate::tools;
use crate::workflow_store::{WorkflowDefinition, WorkflowGraph, WorkflowNode, WorkflowRunRecord, WorkflowStepLog};

const MAX_TEMPLATE_OUTPUT_CHARS: usize = 512 * 1024;
const MAX_PYTHON_OUTPUT_BYTES: usize = 256 * 1024;
const DEFAULT_CODE_TIMEOUT_MS: u64 = 60_000;

/// Migrate legacy `tool` nodes to `toolBuiltin` / `toolMcp` in-place.
pub fn migrate_deprecated_tool_nodes(def: &mut WorkflowDefinition) {
  for n in def.graph.nodes.iter_mut() {
    if n.node_type != "tool" {
      continue;
    }
    let Some(tr) = n.data.get("toolRef").and_then(|x| x.as_str()).map(|s| s.to_string()) else {
      continue;
    };
    if mcp::decode_chat_mcp_tool_name(&tr).is_some() {
      if let Some((cid, rname)) = mcp::decode_chat_mcp_tool_name(&tr) {
        n.node_type = "toolMcp".to_string();
        if let Some(m) = n.data.as_object_mut() {
          m.insert("clientId".to_string(), json!(cid));
          m.insert("remoteToolName".to_string(), json!(rname));
        }
      }
    } else if !tr.is_empty() {
      n.node_type = "toolBuiltin".to_string();
      if let Some(m) = n.data.as_object_mut() {
        m.insert("toolId".to_string(), json!(tr));
      }
    }
  }
}

/// Returns ordered node ids from `start` through middle nodes to `end` (inclusive).
pub fn linearize_chain(graph: &WorkflowGraph) -> Result<Vec<String>, String> {
  let nodes = &graph.nodes;
  let edges = &graph.edges;

  let mut by_id: HashMap<String, &WorkflowNode> = HashMap::new();
  let mut start_ids: Vec<String> = Vec::new();
  let mut end_ids: Vec<String> = Vec::new();
  for n in nodes {
    by_id.insert(n.id.clone(), n);
    match n.node_type.as_str() {
      "start" => start_ids.push(n.id.clone()),
      "end" => end_ids.push(n.id.clone()),
      _ => {}
    }
  }
  if start_ids.len() != 1 {
    return Err("工作流必须有且仅有一个开始节点".to_string());
  }
  if end_ids.len() != 1 {
    return Err("工作流必须有且仅有一个结束节点".to_string());
  }
  let start_id = start_ids[0].clone();
  let end_id = end_ids[0].clone();

  let mut outgoing: HashMap<String, Vec<String>> = HashMap::new();
  for e in edges {
    outgoing
      .entry(e.source.clone())
      .or_default()
      .push(e.target.clone());
  }

  for (_src, tgts) in outgoing.iter_mut() {
    tgts.sort();
    tgts.dedup();
  }

  let mut chain: Vec<String> = Vec::new();
  let mut cur = start_id.clone();
  let mut visited: HashSet<String> = HashSet::new();
  loop {
    if !visited.insert(cur.clone()) {
      return Err("工作流连线成环".to_string());
    }
    chain.push(cur.clone());
    if cur == end_id {
      break;
    }
    let nexts = outgoing.get(&cur).cloned().unwrap_or_default();
    if nexts.is_empty() {
      return Err(format!("从开始节点无法到达结束节点（在 {} 处断开）", cur));
    }
    if nexts.len() > 1 {
      return Err(format!("节点 {} 有多条出边，仅支持单链工作流", cur));
    }
    cur = nexts[0].clone();
  }

  if chain.len() < 2 {
    return Err("工作流至少需要开始与结束节点".to_string());
  }

  for n in nodes {
    if !visited.contains(&n.id) {
      return Err(format!("存在未接入主链的节点: {}", n.id));
    }
  }

  for (i, nid) in chain.iter().enumerate() {
    let node = by_id.get(nid).ok_or_else(|| format!("missing node {}", nid))?;
    let t = node.node_type.as_str();
    if i == 0 && t != "start" {
      return Err("链首必须是开始节点".to_string());
    }
    if i == chain.len() - 1 && t != "end" {
      return Err("链尾必须是结束节点".to_string());
    }
    if i > 0 && i < chain.len() - 1 && !matches!(t, "llm" | "code" | "toolBuiltin" | "toolMcp" | "tool") {
      return Err(format!("中间节点类型非法: {} ({})", nid, t));
    }
  }

  Ok(chain)
}

fn value_to_string(v: &Value) -> String {
  match v {
    Value::String(s) => s.clone(),
    Value::Null => String::new(),
    _ => v.to_string(),
  }
}

fn get_path(ctx: &Value, path: &str) -> Result<Value, String> {
  let parts: Vec<&str> = path.split('.').map(|s| s.trim()).filter(|s| !s.is_empty()).collect();
  if parts.is_empty() {
    return Err("空的变量路径".to_string());
  }
  let mut cur = ctx.clone();
  for p in parts {
    cur = cur
      .get(p)
      .cloned()
      .ok_or_else(|| format!("变量未定义: {}", path))?;
  }
  Ok(cur)
}

/// Expand `{{a.b.c}}` using JSON path segments (dot-separated).
pub fn expand_templates(template: &str, ctx: &Value) -> Result<String, String> {
  let mut out = String::new();
  let mut rest = template;
  while let Some(start) = rest.find("{{") {
    out.push_str(&rest[..start]);
    rest = &rest[start + 2..];
    let end = rest
      .find("}}")
      .ok_or_else(|| "模板中有未闭合的 {{".to_string())?;
    let path = rest[..end].trim();
    let val = get_path(ctx, path)?;
    out.push_str(&value_to_string(&val));
    rest = &rest[end + 2..];
  }
  out.push_str(rest);
  if out.len() > MAX_TEMPLATE_OUTPUT_CHARS {
    return Err("展开后文本过长".to_string());
  }
  Ok(out)
}

fn parse_json_template(s: &str, ctx: &Value) -> Result<Value, String> {
  let expanded = expand_templates(s.trim(), ctx)?;
  if expanded.trim().is_empty() {
    return Ok(Value::Null);
  }
  serde_json::from_str(&expanded).map_err(|e| format!("JSON 解析失败: {}", e))
}

fn node_by_id<'a>(def: &'a WorkflowDefinition, id: &str) -> Option<&'a WorkflowNode> {
  def.graph.nodes.iter().find(|n| n.id == id)
}

pub fn execute_workflow(def: &WorkflowDefinition, start_inputs: Value) -> Result<WorkflowRunRecord, String> {
  let mut def = def.clone();
  migrate_deprecated_tool_nodes(&mut def);
  let chain = linearize_chain(&def.graph)?;
  let run_id = new_run_id();
  let started = now_ms();
  let mut step_logs: Vec<WorkflowStepLog> = Vec::new();
  let mut ctx = json!({
    "start": start_inputs,
    "steps": Value::Object(serde_json::Map::new()),
  });

  let start_node = node_by_id(&def, &chain[0]).ok_or_else(|| "开始节点丢失".to_string())?;
  validate_start_inputs(start_node, &start_inputs)?;

  for nid in chain.iter().skip(1).take(chain.len().saturating_sub(2)) {
    let node = node_by_id(&def, nid).ok_or_else(|| format!("节点不存在: {}", nid))?;
    let t0 = now_ms();
    let step_result = match node.node_type.as_str() {
      "llm" => run_llm_node(node, &ctx),
      "code" => run_code_node(node, &ctx),
      "toolBuiltin" => run_tool_builtin_node(node, &ctx),
      "toolMcp" => run_tool_mcp_node(node, &ctx),
      "tool" => run_tool_node(node, &ctx),
      other => Err(format!("非步骤节点: {}", other)),
    };
    let t1 = now_ms();
    match step_result {
      Ok(out_val) => {
        ctx["steps"]
          .as_object_mut()
          .ok_or_else(|| "context.steps 损坏".to_string())?
          .insert(nid.clone(), out_val.clone());
        let preview = truncate_preview(&out_val);
        step_logs.push(WorkflowStepLog {
          node_id: nid.clone(),
          node_type: node.node_type.clone(),
          started_at: t0,
          finished_at: t1,
          ok: true,
          detail: None,
          output_preview: Some(preview),
        });
      }
      Err(e) => {
        step_logs.push(WorkflowStepLog {
          node_id: nid.clone(),
          node_type: node.node_type.clone(),
          started_at: t0,
          finished_at: t1,
          ok: false,
          detail: Some(e.clone()),
          output_preview: None,
        });
        let finished = now_ms();
        return Ok(WorkflowRunRecord {
          id: run_id,
          workflow_id: def.id.clone(),
          workflow_name_snapshot: def.name.clone(),
          started_at: started,
          finished_at: finished,
          status: "failed".to_string(),
          input: start_inputs,
          outputs: Value::Null,
          step_logs,
          error: Some(e),
        });
      }
    }
  }

  let end_id = chain.last().ok_or_else(|| "链为空".to_string())?.clone();
  let end_node = node_by_id(&def, &end_id).ok_or_else(|| "结束节点丢失".to_string())?;
  let t_end0 = now_ms();
  let final_out = run_end_node(end_node, &ctx);
  let t_end1 = now_ms();
  match final_out {
    Ok(outputs) => {
      step_logs.push(WorkflowStepLog {
        node_id: end_id.clone(),
        node_type: "end".to_string(),
        started_at: t_end0,
        finished_at: t_end1,
        ok: true,
        detail: None,
        output_preview: Some(truncate_preview(&outputs)),
      });
      let finished = now_ms();
      Ok(WorkflowRunRecord {
        id: run_id,
        workflow_id: def.id.clone(),
        workflow_name_snapshot: def.name.clone(),
        started_at: started,
        finished_at: finished,
        status: "ok".to_string(),
        input: start_inputs,
        outputs,
        step_logs,
        error: None,
      })
    }
    Err(e) => {
      step_logs.push(WorkflowStepLog {
        node_id: end_id.clone(),
        node_type: "end".to_string(),
        started_at: t_end0,
        finished_at: t_end1,
        ok: false,
        detail: Some(e.clone()),
        output_preview: None,
      });
      let finished = now_ms();
      Ok(WorkflowRunRecord {
        id: run_id,
        workflow_id: def.id.clone(),
        workflow_name_snapshot: def.name.clone(),
        started_at: started,
        finished_at: finished,
        status: "failed".to_string(),
        input: start_inputs,
        outputs: Value::Null,
        step_logs,
        error: Some(e),
      })
    }
  }
}

fn truncate_preview(v: &Value) -> String {
  let s = serde_json::to_string(v).unwrap_or_else(|_| "<>".to_string());
  if s.len() > 400 {
    format!("{}…", &s[..400])
  } else {
    s
  }
}

fn validate_start_inputs(start_node: &WorkflowNode, inputs: &Value) -> Result<(), String> {
  let data = &start_node.data;
  let params = data
    .get("params")
    .and_then(|p| p.as_array())
    .cloned()
    .unwrap_or_default();
  let obj = inputs
    .as_object()
    .ok_or_else(|| "开始变量必须是 JSON 对象".to_string())?;
  for p in &params {
    let name = p
      .get("name")
      .and_then(|x| x.as_str())
      .ok_or_else(|| "参数缺少 name".to_string())?;
    let required = p.get("required").and_then(|x| x.as_bool()).unwrap_or(false);
    if required && !obj.contains_key(name) {
      return Err(format!("缺少必填参数: {}", name));
    }
  }
  Ok(())
}

fn run_llm_node(node: &WorkflowNode, ctx: &Value) -> Result<Value, String> {
  let data = &node.data;
  let provider_id = data.get("providerId").and_then(|x| {
    if x.is_null() {
      None
    } else {
      x.as_str().map(|s| s.to_string())
    }
  });
  let system_raw = data
    .get("systemPrompt")
    .and_then(|x| x.as_str())
    .unwrap_or("")
    .to_string();
  let user_raw = data
    .get("userPrompt")
    .and_then(|x| x.as_str())
    .ok_or_else(|| "LLM 节点缺少 userPrompt".to_string())?;
  let system = expand_templates(&system_raw, ctx)?;
  let user = expand_templates(user_raw, ctx)?;
  let text = crate::workflow_complete_chat(provider_id, system, user)?;
  Ok(json!({ "text": text }))
}

fn run_tool_node(node: &WorkflowNode, ctx: &Value) -> Result<Value, String> {
  let data = &node.data;
  let tool_ref = data
    .get("toolRef")
    .and_then(|x| x.as_str())
    .ok_or_else(|| "工具节点缺少 toolRef".to_string())?;
  let input_template = data
    .get("inputJson")
    .and_then(|x| x.as_str())
    .unwrap_or("{}");
  let input_val = parse_json_template(input_template, ctx)?;

  if mcp::decode_chat_mcp_tool_name(tool_ref).is_some() {
    let res = mcp::run_mcp_chat_tool(tool_ref, input_val)?;
    if res.ok {
      Ok(json!({ "output": res.output, "name": res.name }))
    } else {
      Err(res.error.unwrap_or_else(|| "MCP 工具失败".to_string()))
    }
  } else {
    let res = tools::run_tool(tool_ref, input_val)?;
    if res.ok {
      Ok(json!({ "output": res.output, "name": res.name }))
    } else {
      Err(res.error.unwrap_or_else(|| "工具执行失败".to_string()))
    }
  }
}

fn coerce_to_schema_type(expanded: &str, prop_schema: &Value) -> Result<Value, String> {
  let typ = prop_schema
    .get("type")
    .and_then(|x| x.as_str())
    .unwrap_or("string");
  let s_trim = expanded.trim();
  match typ {
    "integer" => s_trim
      .parse::<i64>()
      .map(|v| json!(v))
      .map_err(|e| format!("整数解析失败: {} — {}", s_trim, e)),
    "number" => s_trim
      .parse::<f64>()
      .ok()
      .and_then(serde_json::Number::from_f64)
      .map(Value::Number)
      .ok_or_else(|| format!("数字解析失败: {}", s_trim)),
    "boolean" => match s_trim.to_lowercase().as_str() {
      "true" | "1" | "yes" => Ok(json!(true)),
      "false" | "0" | "no" => Ok(json!(false)),
      _ => Err(format!("无效的布尔: {}", s_trim)),
    },
    _ => Ok(Value::String(expanded.to_string())),
  }
}

fn build_object_from_schema_params(
  pv: &serde_json::Map<String, Value>,
  schema: &Value,
  ctx: &Value,
) -> Result<Value, String> {
  let props = schema
    .get("properties")
    .and_then(|x| x.as_object())
    .ok_or_else(|| "工具 schema 缺少 properties".to_string())?;
  let required: Vec<String> = schema
    .get("required")
    .and_then(|x| x.as_array())
    .map(|a| {
      a.iter()
        .filter_map(|v| v.as_str().map(|s| s.to_string()))
        .collect()
    })
    .unwrap_or_default();
  let mut out = serde_json::Map::new();
  for (key, prop_schema) in props {
    let raw = pv.get(key);
    let raw_str = match raw {
      None | Some(Value::Null) => {
        if required.iter().any(|r| r == key) {
          return Err(format!("缺少必填参数: {}", key));
        }
        continue;
      }
      Some(Value::String(s)) => s.clone(),
      Some(v) => v.to_string(),
    };
    let expanded = expand_templates(&raw_str, ctx)?;
    if expanded.trim().is_empty() && !required.iter().any(|r| r == key) {
      continue;
    }
    let v = coerce_to_schema_type(&expanded, prop_schema)?;
    out.insert(key.clone(), v);
  }
  Ok(Value::Object(out))
}

fn resolve_builtin_tool_input(data: &Value, tool_id: &str, ctx: &Value) -> Result<Value, String> {
  if let Some(pv) = data.get("paramValues").and_then(|x| x.as_object()) {
    if !pv.is_empty() {
      let schema = crate::anthropic_tool_input_schema(tool_id);
      return build_object_from_schema_params(pv, &schema, ctx);
    }
  }
  let input_template = data.get("inputJson").and_then(|x| x.as_str()).unwrap_or("{}");
  parse_json_template(input_template, ctx)
}

fn loose_object_from_param_map(
  pv: &serde_json::Map<String, Value>,
  ctx: &Value,
) -> Result<Value, String> {
  let mut out = serde_json::Map::new();
  for (k, v) in pv {
    let s = match v {
      Value::String(s) => s.clone(),
      _ => v.to_string(),
    };
    let expanded = expand_templates(&s, ctx)?;
    let trimmed = expanded.trim();
    let val = if trimmed.starts_with('{') || trimmed.starts_with('[') {
      serde_json::from_str(trimmed).unwrap_or_else(|_| Value::String(expanded.clone()))
    } else if let Ok(n) = trimmed.parse::<i64>() {
      json!(n)
    } else if let Ok(n) = trimmed.parse::<f64>() {
      serde_json::Number::from_f64(n)
        .map(Value::Number)
        .unwrap_or_else(|| Value::String(expanded.to_string()))
    } else if trimmed.eq_ignore_ascii_case("true") {
      json!(true)
    } else if trimmed.eq_ignore_ascii_case("false") {
      json!(false)
    } else {
      Value::String(expanded)
    };
    out.insert(k.clone(), val);
  }
  Ok(Value::Object(out))
}

fn resolve_mcp_tool_input(data: &Value, ctx: &Value) -> Result<Value, String> {
  if let Some(pv) = data.get("paramValues").and_then(|x| x.as_object()) {
    if !pv.is_empty() {
      return loose_object_from_param_map(pv, ctx);
    }
  }
  let input_template = data.get("inputJson").and_then(|x| x.as_str()).unwrap_or("{}");
  parse_json_template(input_template, ctx)
}

fn run_tool_builtin_node(node: &WorkflowNode, ctx: &Value) -> Result<Value, String> {
  let data = &node.data;
  let tool_id = data
    .get("toolId")
    .and_then(|x| x.as_str())
    .or_else(|| data.get("toolRef").and_then(|x| x.as_str()))
    .ok_or_else(|| "内置工具节点缺少 toolId".to_string())?;
  let input_val = resolve_builtin_tool_input(data, tool_id, ctx)?;
  let res = tools::run_tool(tool_id, input_val)?;
  if res.ok {
    Ok(json!({ "output": res.output, "name": res.name }))
  } else {
    Err(res.error.unwrap_or_else(|| "工具执行失败".to_string()))
  }
}

fn run_tool_mcp_node(node: &WorkflowNode, ctx: &Value) -> Result<Value, String> {
  let data = &node.data;
  let client_id = data
    .get("clientId")
    .and_then(|x| x.as_str())
    .ok_or_else(|| "MCP 工具节点缺少 clientId".to_string())?;
  let remote = data
    .get("remoteToolName")
    .and_then(|x| x.as_str())
    .ok_or_else(|| "MCP 工具节点缺少 remoteToolName".to_string())?;
  let enc = mcp::encode_chat_mcp_tool_name(client_id, remote);
  let input_val = resolve_mcp_tool_input(data, ctx)?;
  let res = mcp::run_mcp_chat_tool(&enc, input_val)?;
  if res.ok {
    Ok(json!({ "output": res.output, "name": res.name }))
  } else {
    Err(res.error.unwrap_or_else(|| "MCP 工具失败".to_string()))
  }
}

fn wrap_code_node_output(parsed: &Value, data: &Value) -> Result<Value, String> {
  let keys: Vec<String> = data
    .get("exportKeys")
    .and_then(|x| x.as_array())
    .map(|arr| {
      arr.iter()
        .filter_map(|v| v.as_str().map(|s| s.trim().to_string()))
        .filter(|s| !s.is_empty())
        .collect()
    })
    .unwrap_or_default();
  if keys.is_empty() {
    return Ok(parsed.clone());
  }
  let result = parsed
    .get("result")
    .ok_or_else(|| "代码输出 JSON 缺少 result 字段".to_string())?;
  let obj = result
    .as_object()
    .ok_or_else(|| "配置了导出键时，Python 的 result 必须为 JSON 对象".to_string())?;
  let mut m = serde_json::Map::new();
  m.insert("result".to_string(), result.clone());
  for k in &keys {
    let v = obj
      .get(k)
      .cloned()
      .ok_or_else(|| format!("导出键「{}」在 result 中不存在", k))?;
    m.insert(k.clone(), v);
  }
  Ok(Value::Object(m))
}

fn run_code_node(node: &WorkflowNode, ctx: &Value) -> Result<Value, String> {
  let data = &node.data;
  let source = data
    .get("source")
    .and_then(|x| x.as_str())
    .ok_or_else(|| "代码节点缺少 source".to_string())?;
  let timeout_ms = data
    .get("timeoutMs")
    .and_then(|x| x.as_u64())
    .unwrap_or(DEFAULT_CODE_TIMEOUT_MS);

  let ctx_json = serde_json::to_string(ctx).map_err(|e| e.to_string())?;
  let py = find_python()?;
  let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, source.as_bytes());
  let runner = format!(
    r#"
import base64, json, sys
ctx = json.loads(sys.stdin.read())
_C = "{}"
code = base64.b64decode(_C.encode("ascii")).decode("utf-8")
g = {{"context": ctx, "json": json}}
exec(compile(code, "<workflow>", "exec"), g, g)
result = g.get("result")
sys.stdout.buffer.write(json.dumps({{"result": result}}, ensure_ascii=False).encode("utf-8"))
"#,
    b64
  );

  let mut child = python_command(&py, &runner)
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .spawn()
    .map_err(|e| format!("无法启动 Python ({}): {}", py, e))?;

  if let Some(mut stdin) = child.stdin.take() {
    stdin
      .write_all(ctx_json.as_bytes())
      .map_err(|e| format!("写入 stdin 失败: {}", e))?;
  }

  let deadline = Instant::now() + Duration::from_millis(timeout_ms);
  loop {
    match child.try_wait() {
      Ok(Some(status)) => {
        let mut stdout = child.stdout.take();
        let mut stderr = child.stderr.take();
        let out = read_pipe(&mut stdout, MAX_PYTHON_OUTPUT_BYTES)?;
        let err = read_pipe(&mut stderr, 8192)?;
        if !status.success() {
          return Err(format!(
            "Python 退出码 {:?}: {}",
            status.code(),
            String::from_utf8_lossy(&err)
          ));
        }
        let parsed: Value = serde_json::from_slice(&out).map_err(|e| {
          format!(
            "解析 Python 输出 JSON 失败: {} — {}",
            e,
            String::from_utf8_lossy(&out)
          )
        })?;
        return wrap_code_node_output(&parsed, data);
      }
      Ok(None) => {
        if Instant::now() > deadline {
          let _ = child.kill();
          return Err("Python 执行超时".to_string());
        }
        thread::sleep(Duration::from_millis(30));
      }
      Err(e) => return Err(format!("等待 Python 进程: {}", e)),
    }
  }
}

fn read_pipe<R: Read>(r: &mut Option<R>, max: usize) -> Result<Vec<u8>, String> {
  let Some(r) = r.as_mut() else {
    return Ok(Vec::new());
  };
  let mut buf = Vec::new();
  let mut chunk = [0u8; 8192];
  loop {
    let n = r.read(&mut chunk).map_err(|e| e.to_string())?;
    if n == 0 {
      break;
    }
    if buf.len() + n > max {
      return Err("管道输出过长".to_string());
    }
    buf.extend_from_slice(&chunk[..n]);
  }
  Ok(buf)
}

fn run_end_node(node: &WorkflowNode, ctx: &Value) -> Result<Value, String> {
  let data = &node.data;
  if let Some(t) = data.get("outputTemplate").and_then(|x| x.as_str()) {
    let s = expand_templates(t, ctx)?;
    return Ok(Value::String(s));
  }
  if let Some(fields) = data.get("outputFields").and_then(|x| x.as_array()) {
    let mut map = serde_json::Map::new();
    for f in fields {
      let key = f
        .get("key")
        .and_then(|x| x.as_str())
        .ok_or_else(|| "outputFields 缺少 key".to_string())?;
      let tmpl = f.get("valueTemplate").and_then(|x| x.as_str()).unwrap_or("");
      let val = expand_templates(tmpl, ctx)?;
      map.insert(key.to_string(), Value::String(val));
    }
    return Ok(Value::Object(map));
  }
  Err("结束节点需要 outputTemplate 或 outputFields".to_string())
}

fn now_ms() -> i64 {
  use std::time::{SystemTime, UNIX_EPOCH};
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|d| d.as_millis() as i64)
    .unwrap_or(0)
}

fn new_run_id() -> String {
  use std::time::{SystemTime, UNIX_EPOCH};
  let n = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|d| d.as_nanos())
    .unwrap_or(0);
  format!("run-{}", n)
}

fn find_python() -> Result<String, String> {
  if cfg!(windows) {
    if Command::new("py")
      .args(["-3", "-c", "print(1)"])
      .output()
      .map(|o| o.status.success())
      .unwrap_or(false)
    {
      return Ok("py".to_string());
    }
  }
  if Command::new("python3")
    .args(["-c", "print(1)"])
    .output()
    .map(|o| o.status.success())
    .unwrap_or(false)
  {
    return Ok("python3".to_string());
  }
  if Command::new("python")
    .args(["-c", "print(1)"])
    .output()
    .map(|o| o.status.success())
    .unwrap_or(false)
  {
    return Ok("python".to_string());
  }
  Err("未找到 Python，请安装 Python 3 并加入 PATH".to_string())
}

fn python_command(py: &str, script: &str) -> Command {
  if py == "py" {
    let mut c = Command::new("py");
    c.args(["-3", "-c", script]);
    c
  } else {
    let mut c = Command::new(py);
    c.arg("-c").arg(script);
    c
  }
}
