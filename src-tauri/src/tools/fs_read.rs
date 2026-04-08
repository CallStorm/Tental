use super::{helpers_check_path_allowed, RunToolResponse, ToolSecurityConfig};
use serde_json::{json, Value};
use std::fs::File;
use std::io::{BufRead, BufReader, Read};
use std::path::PathBuf;

fn looks_binary(buf: &[u8]) -> bool {
  buf.iter().any(|&b| b == 0)
}

pub fn run(security: &ToolSecurityConfig, input: Value) -> Result<RunToolResponse, String> {
  let path = input
    .get("path")
    .and_then(|v| v.as_str())
    .ok_or_else(|| "missing input.path".to_string())?;
  let start_line = input.get("startLine").and_then(|v| v.as_i64()).unwrap_or(1);
  let max_lines = input
    .get("maxLines")
    .and_then(|v| v.as_u64())
    .map(|x| x as usize)
    .unwrap_or(security.max_read_lines);

  let p = PathBuf::from(path);
  helpers_check_path_allowed(security, &p)?;

  let meta = std::fs::metadata(&p).map_err(|e| e.to_string())?;
  if meta.len() > security.max_file_bytes {
    return Ok(RunToolResponse {
      ok: false,
      name: "read_file".to_string(),
      output: json!({ "maxFileBytes": security.max_file_bytes, "actualBytes": meta.len() }),
      error: Some("file_too_large".to_string()),
      error_code: Some("file_too_large".to_string()),
    });
  }

  if security.reject_binary {
    let mut f = File::open(&p).map_err(|e| e.to_string())?;
    let mut probe = vec![0u8; 8192];
    let n = f.read(&mut probe).map_err(|e| e.to_string())?;
    probe.truncate(n);
    if looks_binary(&probe) {
      return Ok(RunToolResponse {
        ok: false,
        name: "read_file".to_string(),
        output: json!({}),
        error: Some("binary_file_rejected".to_string()),
        error_code: Some("binary_file_rejected".to_string()),
      });
    }
  }

  let f = File::open(&p).map_err(|e| e.to_string())?;
  let reader = BufReader::new(f);

  let mut out_lines: Vec<String> = Vec::new();
  let mut line_no: i64 = 0;
  let start = if start_line < 1 { 1 } else { start_line };
  for line in reader.lines() {
    let line = line.map_err(|e| e.to_string())?;
    line_no += 1;
    if line_no < start {
      continue;
    }
    out_lines.push(line);
    if out_lines.len() >= max_lines {
      break;
    }
  }

  Ok(RunToolResponse {
    ok: true,
    name: "read_file".to_string(),
    output: json!({
      "path": path,
      "startLine": start,
      "maxLines": max_lines,
      "lines": out_lines,
    }),
    error: None,
    error_code: None,
  })
}

