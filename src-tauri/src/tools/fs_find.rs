use super::{helpers_check_path_allowed, RunToolResponse, ToolSecurityConfig};
use globset::{Glob, GlobSetBuilder};
use serde_json::{json, Value};
use std::path::PathBuf;
use walkdir::WalkDir;

pub fn run(security: &ToolSecurityConfig, input: Value) -> Result<RunToolResponse, String> {
  let root = input
    .get("root")
    .and_then(|v| v.as_str())
    .unwrap_or(".");
  let query = input.get("query").and_then(|v| v.as_str()).unwrap_or("");
  let glob = input.get("glob").and_then(|v| v.as_str()).unwrap_or("");
  let max_results = input
    .get("maxResults")
    .and_then(|v| v.as_u64())
    .map(|x| x as usize)
    .unwrap_or(200);

  let root_path = PathBuf::from(root);
  helpers_check_path_allowed(security, &root_path)?;

  let matcher = if !glob.trim().is_empty() {
    let mut b = GlobSetBuilder::new();
    b.add(Glob::new(glob).map_err(|e| e.to_string())?);
    Some(b.build().map_err(|e| e.to_string())?)
  } else {
    None
  };

  let q = query.to_lowercase();
  let mut out: Vec<String> = Vec::new();
  for entry in WalkDir::new(&root_path).follow_links(false).into_iter() {
    let entry = match entry {
      Ok(e) => e,
      Err(_) => continue,
    };
    if !entry.file_type().is_file() {
      continue;
    }
    let p = entry.path();
    if let Some(m) = &matcher {
      if !m.is_match(p) {
        continue;
      }
    }
    if !q.is_empty() {
      let name = p.file_name().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
      if !name.contains(&q) {
        continue;
      }
    }
    out.push(p.to_string_lossy().to_string());
    if out.len() >= max_results {
      break;
    }
  }

  Ok(RunToolResponse {
    ok: true,
    name: "find".to_string(),
    output: json!({
      "root": root,
      "query": query,
      "glob": if glob.is_empty() { Value::Null } else { Value::String(glob.to_string()) },
      "results": out,
    }),
    error: None,
    error_code: None,
  })
}

