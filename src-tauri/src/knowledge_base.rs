//! Markdown knowledge base under `~/.tental/kbs`.

use crate::get_tental_dir_path;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

fn kb_root() -> Result<PathBuf, String> {
  let root = get_tental_dir_path()?.join("kbs");
  fs::create_dir_all(&root).map_err(|e| e.to_string())?;
  Ok(root)
}

/// Resolve a relative path under the knowledge base. Rejects `..` and empty segments.
pub(crate) fn resolve_kb_path(rel: &str) -> Result<PathBuf, String> {
  let base = kb_root()?;
  let base_canon = base.canonicalize().map_err(|e| e.to_string())?;
  let rel = rel.replace('\\', "/");
  if rel.is_empty() {
    return Err("path is empty".into());
  }
  if rel.contains("..") {
    return Err("invalid path".into());
  }
  let mut out = base_canon.clone();
  for seg in rel.split('/').filter(|s| !s.is_empty()) {
    if seg == ".." {
      return Err("invalid path segment".into());
    }
    out.push(seg);
  }
  if !out.starts_with(&base_canon) {
    return Err("path escapes knowledge base root".into());
  }
  Ok(out)
}

fn file_stem_name(path: &Path) -> String {
  path
    .file_stem()
    .map(|s| s.to_string_lossy().into_owned())
    .unwrap_or_default()
}

/// Split optional YAML frontmatter (first `---` .. `---`). Returns (header, body).
fn split_frontmatter<'a>(content: &'a str) -> (Option<&'a str>, &'a str) {
  let content = content.strip_prefix('\u{feff}').unwrap_or(content);
  if !content.starts_with("---") {
    return (None, content);
  }
  let after_open = &content[3..];
  let after_open = match after_open
    .strip_prefix("\r\n")
    .or_else(|| after_open.strip_prefix('\n'))
  {
    Some(r) => r,
    None => return (None, content),
  };
  let mut sep = None;
  for (idx, _) in after_open.match_indices("\n---") {
    sep = Some(idx);
    break;
  }
  let Some(end_hdr) = sep else {
    return (None, content);
  };
  let header = &after_open[..end_hdr];
  let rest = &after_open[end_hdr + "\n---".len()..];
  let rest = rest
    .strip_prefix("\r\n")
    .or_else(|| rest.strip_prefix('\n'))
    .unwrap_or(rest);
  (Some(header), rest)
}

fn parse_yaml_quoted(s: &str) -> String {
  let s = s.trim();
  if (s.starts_with('"') && s.ends_with('"')) || (s.starts_with('\'') && s.ends_with('\'')) {
    s[1..s.len().saturating_sub(1)].to_string()
  } else {
    s.to_string()
  }
}

/// Parse `title` and `tags` from a simple YAML frontmatter block.
fn parse_frontmatter_header(header: &str) -> (Option<String>, Vec<String>) {
  let mut title: Option<String> = None;
  let mut tags: Vec<String> = Vec::new();
  let lines: Vec<&str> = header.lines().collect();
  let mut i = 0usize;
  while i < lines.len() {
    let line = lines[i];
    let t = line.trim();
    if let Some(rest) = t.strip_prefix("title:") {
      title = Some(parse_yaml_quoted(rest));
      i += 1;
      continue;
    }
    if let Some(rest) = t.strip_prefix("tags:") {
      let rest = rest.trim();
      if rest.starts_with('[') {
        let inner = rest.trim_start_matches('[').trim_end_matches(']');
        for part in inner.split(',') {
          let p = parse_yaml_quoted(part);
          if !p.is_empty() {
            tags.push(p);
          }
        }
        i += 1;
        continue;
      }
      if rest.is_empty() {
        i += 1;
        while i < lines.len() {
          let ln = lines[i].trim();
          if let Some(item) = ln.strip_prefix('-') {
            tags.push(parse_yaml_quoted(item));
            i += 1;
          } else if ln.is_empty() {
            i += 1;
          } else {
            break;
          }
        }
        continue;
      }
    }
    i += 1;
  }
  (title, tags)
}

/// Read title and tags from the start of a markdown file (frontmatter only).
fn read_md_meta(path: &Path) -> (String, Vec<String>) {
  let raw = match fs::read_to_string(path) {
    Ok(s) => s,
    Err(_) => return (file_stem_name(path), vec![]),
  };
  let (hdr, _) = split_frontmatter(&raw);
  let stem = file_stem_name(path);
  let Some(h) = hdr else {
    return (stem, vec![]);
  };
  let (t, tags) = parse_frontmatter_header(h);
  let title = t.unwrap_or(stem);
  (title, tags)
}

fn read_full_meta(content: &str, path: &Path) -> (String, Vec<String>) {
  let (hdr, _) = split_frontmatter(content);
  let stem = file_stem_name(path);
  let Some(h) = hdr else {
    return (stem, vec![]);
  };
  let (t, tags) = parse_frontmatter_header(h);
  (t.unwrap_or(stem), tags)
}

fn body_for_search(content: &str) -> String {
  let (_, body) = split_frontmatter(content);
  body.to_string()
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct KbTreeEntry {
  pub kind: String,
  pub name: String,
  pub rel_path: String,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub title: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub tags: Option<Vec<String>>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub children: Option<Vec<KbTreeEntry>>,
}

fn rel_path_str(base: &Path, full: &Path) -> Result<String, String> {
  let rel = full.strip_prefix(base).map_err(|_| "path prefix".to_string())?;
  Ok(rel.to_string_lossy().replace('\\', "/"))
}

fn list_dir_sorted(path: &Path) -> Result<Vec<PathBuf>, String> {
  let mut entries: Vec<PathBuf> = fs::read_dir(path)
    .map_err(|e| e.to_string())?
    .filter_map(|e| e.ok())
    .map(|e| e.path())
    .collect();
  entries.sort_by(|a, b| {
    let da = a.is_dir();
    let db = b.is_dir();
    match (da, db) {
      (true, false) => std::cmp::Ordering::Less,
      (false, true) => std::cmp::Ordering::Greater,
      _ => a
        .file_name()
        .unwrap_or_default()
        .cmp(b.file_name().unwrap_or_default()),
    }
  });
  Ok(entries)
}

fn build_tree(base: &Path, current: &Path) -> Result<Option<KbTreeEntry>, String> {
  let name = current
    .file_name()
    .map(|s| s.to_string_lossy().into_owned())
    .unwrap_or_default();
  let rel = rel_path_str(base, current)?;
  if current.is_dir() {
    let mut children: Vec<KbTreeEntry> = Vec::new();
    for p in list_dir_sorted(current)? {
      if p.is_dir() {
        if let Some(node) = build_tree(base, &p)? {
          children.push(node);
        }
      } else if p.extension().and_then(|e| e.to_str()).map(|e| e.eq_ignore_ascii_case("md")) == Some(true) {
        let (title, tags) = read_md_meta(&p);
        let rp = rel_path_str(base, &p)?;
        children.push(KbTreeEntry {
          kind: "file".into(),
          name: p
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default(),
          rel_path: rp,
          title: Some(title),
          tags: Some(tags),
          children: None,
        });
      }
    }
    Ok(Some(KbTreeEntry {
      kind: "dir".into(),
      name,
      rel_path: rel,
      title: None,
      tags: None,
      children: Some(children),
    }))
  } else {
    Ok(None)
  }
}

#[tauri::command(rename_all = "camelCase")]
pub fn kb_list_tree() -> Result<Vec<KbTreeEntry>, String> {
  let base = kb_root()?;
  let root = build_tree(&base, &base)?;
  Ok(root.map(|r| vec![r]).unwrap_or_default())
}

#[tauri::command(rename_all = "camelCase")]
pub fn kb_read(rel_path: String) -> Result<String, String> {
  let path = resolve_kb_path(&rel_path)?;
  if !path.is_file() {
    return Err("not a file".into());
  }
  fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KbWriteReq {
  pub rel_path: String,
  pub content: String,
}

#[tauri::command(rename_all = "camelCase")]
pub fn kb_write(req: KbWriteReq) -> Result<(), String> {
  let path = resolve_kb_path(&req.rel_path)?;
  if let Some(parent) = path.parent() {
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
  }
  fs::write(&path, req.content).map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "camelCase")]
pub fn kb_delete(rel_path: String) -> Result<(), String> {
  let path = resolve_kb_path(&rel_path)?;
  if path.is_dir() {
    fs::remove_dir_all(&path).map_err(|e| e.to_string())?;
  } else if path.is_file() {
    fs::remove_file(&path).map_err(|e| e.to_string())?;
  } else {
    return Err("path does not exist".into());
  }
  Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KbRenameReq {
  pub from_rel_path: String,
  pub to_rel_path: String,
}

#[tauri::command(rename_all = "camelCase")]
pub fn kb_rename(req: KbRenameReq) -> Result<(), String> {
  let from = resolve_kb_path(&req.from_rel_path)?;
  let to = resolve_kb_path(&req.to_rel_path)?;
  if let Some(parent) = to.parent() {
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
  }
  fs::rename(&from, &to).map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "camelCase")]
pub fn kb_mkdir(rel_path: String) -> Result<(), String> {
  let path = resolve_kb_path(&rel_path)?;
  fs::create_dir_all(&path).map_err(|e| e.to_string())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KbSearchReq {
  pub query: Option<String>,
  pub tags: Option<Vec<String>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KbSearchHit {
  pub rel_path: String,
  pub title: String,
  pub snippet: String,
  pub tags: Vec<String>,
}

#[tauri::command(rename_all = "camelCase")]
pub fn kb_search(req: KbSearchReq) -> Result<Vec<KbSearchHit>, String> {
  let base = kb_root()?;
  let base_canon = base.canonicalize().map_err(|e| e.to_string())?;
  let q = req
    .query
    .as_ref()
    .map(|s| s.trim().to_lowercase())
    .filter(|s| !s.is_empty());
  let tag_filter: Vec<String> = req
    .tags
    .unwrap_or_default()
    .into_iter()
    .map(|t| t.trim().to_lowercase())
    .filter(|t| !t.is_empty())
    .collect();

  let mut hits: Vec<KbSearchHit> = Vec::new();

  for entry in WalkDir::new(&base_canon).into_iter().filter_map(|e| e.ok()) {
    let path = entry.path();
    if !path.is_file() {
      continue;
    }
    if path.extension().and_then(|e| e.to_str()).map(|e| e.eq_ignore_ascii_case("md")) != Some(true) {
      continue;
    }
    let rel = rel_path_str(&base_canon, path)?;
    let content = match fs::read_to_string(path) {
      Ok(c) => c,
      Err(_) => continue,
    };
    let (title, doc_tags) = read_full_meta(&content, path);
    let body = body_for_search(&content);
    let body_lower = body.to_lowercase();
    let title_lower = title.to_lowercase();

    let tags_ok = tag_filter.iter().all(|tf| {
      doc_tags
        .iter()
        .any(|t| t.trim().to_lowercase() == *tf)
    });
    if !tags_ok {
      continue;
    }

    if let Some(ref query) = q {
      if !title_lower.contains(query) && !body_lower.contains(query) {
        continue;
      }
    }

    let snippet: String = body.chars().take(220).collect();

    hits.push(KbSearchHit {
      rel_path: rel,
      title,
      snippet,
      tags: doc_tags,
    });
  }

  hits.sort_by(|a, b| a.rel_path.cmp(&b.rel_path));
  Ok(hits)
}

/// Resolve `href` from a markdown file to an absolute filesystem path under the knowledge base (for `convertFileSrc`).
#[tauri::command(rename_all = "camelCase")]
pub fn kb_resolve_asset_path(doc_rel_path: String, href: String) -> Result<String, String> {
  let href = href.trim();
  if href.is_empty() {
    return Err("empty href".into());
  }
  if href.starts_with("http://")
    || href.starts_with("https://")
    || href.starts_with("data:")
  {
    return Err("not a local path".into());
  }
  let kb_canon = kb_root()?.canonicalize().map_err(|e| e.to_string())?;
  let doc = resolve_kb_path(&doc_rel_path)?;
  if !doc.is_file() {
    return Err("document is not a file".into());
  }
  let parent = doc.parent().ok_or("document has no parent directory")?;
  let combined = parent.join(href.trim_start_matches("./"));
  let combined = fs::canonicalize(&combined).unwrap_or(combined);
  if !combined.starts_with(&kb_canon) {
    return Err("asset path escapes knowledge base root".into());
  }
  Ok(combined.to_string_lossy().into_owned())
}
