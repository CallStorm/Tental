use super::{helpers_check_path_allowed, RunToolResponse, ToolSecurityConfig};
use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;

pub fn run(security: &ToolSecurityConfig, input: Value) -> Result<RunToolResponse, String> {
  let path = input
    .get("path")
    .and_then(|v| v.as_str())
    .ok_or_else(|| "missing input.path".to_string())?;
  let find = input
    .get("find")
    .and_then(|v| v.as_str())
    .ok_or_else(|| "missing input.find".to_string())?;
  let replace = input
    .get("replace")
    .and_then(|v| v.as_str())
    .ok_or_else(|| "missing input.replace".to_string())?;
  let all = input.get("all").and_then(|v| v.as_bool()).unwrap_or(false);

  let p = PathBuf::from(path);
  helpers_check_path_allowed(security, &p)?;

  let content = fs::read_to_string(&p).map_err(|e| e.to_string())?;
  let (next, count) = if all {
    let count = content.matches(find).count();
    (content.replace(find, replace), count)
  } else {
    if let Some(pos) = content.find(find) {
      let mut out = String::with_capacity(content.len() - find.len() + replace.len());
      out.push_str(&content[..pos]);
      out.push_str(replace);
      out.push_str(&content[pos + find.len()..]);
      (out, 1)
    } else {
      (content.clone(), 0)
    }
  };

  if next.as_bytes().len() as u64 > security.max_file_bytes {
    return Ok(RunToolResponse {
      ok: false,
      name: "edit_file".to_string(),
      output: json!({ "maxFileBytes": security.max_file_bytes, "actualBytes": next.as_bytes().len() }),
      error: Some("file_too_large".to_string()),
      error_code: Some("file_too_large".to_string()),
    });
  }

  if count > 0 {
    let tmp = p.with_extension(format!("tmp.{}", super::helpers_now_ms()));
    fs::write(&tmp, &next).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &p).map_err(|e| e.to_string())?;
  }

  Ok(RunToolResponse {
    ok: true,
    name: "edit_file".to_string(),
    output: json!({ "path": path, "replaced": count }),
    error: None,
    error_code: None,
  })
}

