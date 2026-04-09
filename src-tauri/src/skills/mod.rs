//! Built-in and user skills under `~/.tental/skills` and `~/.tental/customized_skills`.

use crate::get_tental_dir_path;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Cursor;
use base64::Engine;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use walkdir::WalkDir;

/// Windows default path from plan (Copaw workspace default skills).
const DEFAULT_COPAW_SKILLS_DIR: &str = r"C:\Users\Administrator\.copaw\workspaces\default\skills";
const BUILTIN_SEED_NAMES: &[&str] = &["docx", "pdf", "pptx", "xlsx"];

fn now_ms() -> i64 {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|d| d.as_millis() as i64)
    .unwrap_or(0)
}

fn skills_state_path() -> Result<PathBuf, String> {
  Ok(get_tental_dir_path()?.join("skills-state.json"))
}

fn skills_builtin_dir() -> Result<PathBuf, String> {
  Ok(get_tental_dir_path()?.join("skills"))
}

fn skills_custom_dir() -> Result<PathBuf, String> {
  Ok(get_tental_dir_path()?.join("customized_skills"))
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct SkillsStateFile {
  #[serde(default)]
  version: u32,
  #[serde(default)]
  items: Vec<SkillStateItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SkillStateItem {
  name: String,
  enabled: bool,
  /// `builtin` | `custom`
  source: String,
  #[serde(default)]
  path: String,
  #[serde(default)]
  updated_at: i64,
}

fn load_skills_state() -> Result<SkillsStateFile, String> {
  let p = skills_state_path()?;
  if !p.exists() {
    return Ok(SkillsStateFile {
      version: 1,
      items: vec![],
    });
  }
  let raw = fs::read_to_string(&p).map_err(|e| e.to_string())?;
  let mut s: SkillsStateFile = serde_json::from_str(&raw).unwrap_or_else(|_| SkillsStateFile {
    version: 1,
    items: vec![],
  });
  s.version = s.version.max(1);
  Ok(s)
}

fn save_skills_state(state: &SkillsStateFile) -> Result<(), String> {
  let p = skills_state_path()?;
  let mut to_save = state.clone();
  to_save.version = 1;
  let raw = serde_json::to_string_pretty(&to_save).map_err(|e| e.to_string())?;
  fs::write(&p, raw).map_err(|e| e.to_string())
}

/// Filenames accepted as the skill markdown entry (case variants from published zips).
const SKILL_MD_NAMES: &[&str] = &["SKILL.md", "skill.md", "Skill.md"];

fn skill_md_path_in_dir(dir: &Path) -> Option<PathBuf> {
  for n in SKILL_MD_NAMES {
    let p = dir.join(n);
    if p.is_file() {
      return Some(p);
    }
  }
  None
}

fn has_skill_md(dir: &Path) -> bool {
  skill_md_path_in_dir(dir).is_some()
}

fn is_junk_zip_entry_os_name(name: &std::ffi::OsStr) -> bool {
  let s = name.to_string_lossy();
  let t = s.trim();
  t == "__MACOSX"
    || t == ".DS_Store"
    || t.starts_with("._")
    || t.is_empty()
}

fn read_zip_extract_entries(dir: &Path) -> Result<Vec<std::fs::DirEntry>, String> {
  let v: Vec<_> = fs::read_dir(dir)
    .map_err(|e| e.to_string())?
    .filter_map(|e| e.ok())
    .filter(|e| !is_junk_zip_entry_os_name(&e.file_name()))
    .collect();
  Ok(v)
}

pub fn validate_skill_name(name: &str) -> Result<(), String> {
  let n = name.trim();
  if n.is_empty() {
    return Err("技能名称不能为空".to_string());
  }
  if n != name {
    return Err("技能名称首尾不能有空格".to_string());
  }
  for ch in n.chars() {
    let ok = ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '_' || ch == '-';
    if !ok {
      return Err("技能名称仅允许小写字母、数字、下划线和连字符".to_string());
    }
  }
  Ok(())
}

#[derive(Debug, Clone, Default)]
struct Frontmatter {
  name: Option<String>,
  description: Option<String>,
}

fn parse_skill_frontmatter(raw: &str) -> (Frontmatter, String) {
  let trimmed = raw.trim_start_matches('\u{feff}');
  if !trimmed.starts_with("---") {
    return (Frontmatter::default(), trimmed.to_string());
  }
  let rest = &trimmed[3..];
  let end = rest.find("\n---");
  if end.is_none() {
    return (Frontmatter::default(), trimmed.to_string());
  }
  let end = end.unwrap();
  let fm_block = &rest[..end];
  let body_start = rest[end + 4..].trim_start();
  let body = body_start.to_string();

  let mut fm = Frontmatter::default();
  for line in fm_block.lines() {
    let line = line.trim();
    if line.is_empty() || line.starts_with('#') {
      continue;
    }
    if let Some((k, v)) = line.split_once(':') {
      let key = k.trim().to_lowercase();
      let val = v.trim().trim_matches('"').trim_matches('\'').to_string();
      match key.as_str() {
        "name" => fm.name = Some(val),
        "description" => fm.description = Some(val),
        _ => {}
      }
    }
  }
  (fm, body)
}

fn read_skill_description(skill_root: &Path) -> Result<String, String> {
  let skill_md = skill_md_path_in_dir(skill_root)
    .ok_or_else(|| "SKILL.md 缺失".to_string())?;
  let raw = fs::read_to_string(&skill_md).map_err(|e| e.to_string())?;
  let (fm, _) = parse_skill_frontmatter(&raw);
  Ok(fm
    .description
    .unwrap_or_else(|| "（无描述）".to_string()))
}

fn skill_updated_at_ms(skill_root: &Path) -> i64 {
  let Some(skill_md) = skill_md_path_in_dir(skill_root) else {
    return 0;
  };
  fs::metadata(&skill_md)
    .and_then(|m| m.modified())
    .ok()
    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
    .map(|d| d.as_millis() as i64)
    .unwrap_or(0)
}

fn read_skill_config_channels(skill_root: &Path) -> String {
  let cfg_path = skill_root.join("config.json");
  let Ok(raw) = fs::read_to_string(&cfg_path) else {
    return "所有".to_string();
  };
  let v: serde_json::Value = serde_json::from_str(&raw).unwrap_or(serde_json::json!({}));
  v.get("applicableChannels")
    .or_else(|| v.get("applicable_channels"))
    .and_then(|x| x.as_str())
    .map(|s| s.to_string())
    .filter(|s| !s.is_empty())
    .unwrap_or_else(|| "所有".to_string())
}

fn copy_dir_all(src: &Path, dst: &Path) -> Result<(), String> {
  if !src.is_dir() {
    return Err("copy_dir_all: 源不是目录".to_string());
  }
  fs::create_dir_all(dst).map_err(|e| e.to_string())?;
  for entry in WalkDir::new(src).into_iter().filter_map(|e| e.ok()) {
    let path = entry.path();
    let rel = path
      .strip_prefix(src)
      .map_err(|e| e.to_string())?;
    let target = dst.join(rel);
    if entry.file_type().is_dir() {
      fs::create_dir_all(&target).map_err(|e| e.to_string())?;
    } else if entry.file_type().is_file() {
      if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
      }
      fs::copy(path, &target).map_err(|e| e.to_string())?;
    }
  }
  Ok(())
}

fn remove_dir_all(path: &Path) -> Result<(), String> {
  if path.exists() {
    fs::remove_dir_all(path).map_err(|e| e.to_string())?;
  }
  Ok(())
}

/// If `~/.tental/skills` has no valid skill subdirs, copy seeded builtins from Copaw (Windows only).
pub fn bootstrap_builtin_skills() -> Result<(), String> {
  let dest_root = skills_builtin_dir()?;
  fs::create_dir_all(&dest_root).map_err(|e| e.to_string())?;

  let has_any = fs::read_dir(&dest_root)
    .map_err(|e| e.to_string())?
    .filter_map(|e| e.ok())
    .any(|e| {
      let p = e.path();
      p.is_dir() && has_skill_md(&p)
    });
  if has_any {
    return Ok(());
  }

  let src_root = PathBuf::from(DEFAULT_COPAW_SKILLS_DIR);
  if !src_root.is_dir() {
    log::info!(
      "[skills] skip bootstrap: source dir missing: {}",
      src_root.display()
    );
    return Ok(());
  }

  for name in BUILTIN_SEED_NAMES {
    let src = src_root.join(name);
    let dst = dest_root.join(name);
    if dst.exists() {
      continue;
    }
    if src.is_dir() && has_skill_md(&src) {
      copy_dir_all(&src, &dst)?;
      log::info!("[skills] bootstrapped builtin skill: {}", name);
    }
  }
  Ok(())
}

fn list_skill_dirs(root: &Path) -> Result<Vec<PathBuf>, String> {
  if !root.exists() {
    return Ok(vec![]);
  }
  let mut out = Vec::new();
  for entry in fs::read_dir(root).map_err(|e| e.to_string())? {
    let entry = entry.map_err(|e| e.to_string())?;
    let p = entry.path();
    if p.is_dir() && has_skill_md(&p) {
      out.push(p);
    }
  }
  out.sort_by(|a, b| {
    a.file_name()
      .unwrap_or_default()
      .cmp(b.file_name().unwrap_or_default())
  });
  Ok(out)
}

fn collect_skill_name_set(builtin_root: &Path, custom_root: &Path) -> Result<HashSet<String>, String> {
  let mut set = HashSet::new();
  for p in list_skill_dirs(builtin_root)? {
    if let Some(n) = p.file_name().and_then(|s| s.to_str()) {
      set.insert(n.to_string());
    }
  }
  for p in list_skill_dirs(custom_root)? {
    if let Some(n) = p.file_name().and_then(|s| s.to_str()) {
      if set.contains(n) {
        return Err(format!("技能目录冲突：重名 {}", n));
      }
      set.insert(n.to_string());
    }
  }
  Ok(set)
}

fn merge_state_with_disk(
  state: &mut SkillsStateFile,
  builtin_root: &Path,
  custom_root: &Path,
) -> Result<(), String> {
  let mut by_name: HashMap<String, SkillStateItem> = HashMap::new();
  for it in state.items.drain(..) {
    by_name.insert(it.name.clone(), it);
  }

  let mut next_items: Vec<SkillStateItem> = Vec::new();

  for p in list_skill_dirs(builtin_root)? {
    let name = p
      .file_name()
      .and_then(|s| s.to_str())
      .ok_or_else(|| "无效技能目录名".to_string())?
      .to_string();
    let path_str = p.to_string_lossy().to_string();
    let updated = skill_updated_at_ms(&p);
    let default = SkillStateItem {
      name: name.clone(),
      enabled: true,
      source: "builtin".to_string(),
      path: path_str.clone(),
      updated_at: updated,
    };
    let mut item = by_name.remove(&name).unwrap_or(default);
    item.source = "builtin".to_string();
    item.path = path_str;
    item.updated_at = updated;
    next_items.push(item);
  }

  for p in list_skill_dirs(custom_root)? {
    let name = p
      .file_name()
      .and_then(|s| s.to_str())
      .ok_or_else(|| "无效技能目录名".to_string())?
      .to_string();
    let path_str = p.to_string_lossy().to_string();
    let updated = skill_updated_at_ms(&p);
    let default = SkillStateItem {
      name: name.clone(),
      enabled: true,
      source: "custom".to_string(),
      path: path_str.clone(),
      updated_at: updated,
    };
    let mut item = by_name.remove(&name).unwrap_or(default);
    item.source = "custom".to_string();
    item.path = path_str;
    item.updated_at = updated;
    next_items.push(item);
  }

  // drop stale state entries not on disk
  state.items = next_items;
  Ok(())
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SkillMeta {
  pub name: String,
  pub description: String,
  pub source: String,
  pub enabled: bool,
  pub updated_at: i64,
  pub applicable_channels: String,
}

pub fn list_skills() -> Result<Vec<SkillMeta>, String> {
  bootstrap_builtin_skills()?;
  let builtin_root = skills_builtin_dir()?;
  let custom_root = skills_custom_dir()?;
  fs::create_dir_all(&builtin_root).map_err(|e| e.to_string())?;
  fs::create_dir_all(&custom_root).map_err(|e| e.to_string())?;

  let mut state = load_skills_state()?;
  merge_state_with_disk(&mut state, &builtin_root, &custom_root)?;
  save_skills_state(&state)?;

  let mut out: Vec<SkillMeta> = Vec::new();
  for item in &state.items {
    let root = PathBuf::from(&item.path);
    let description = read_skill_description(&root).unwrap_or_else(|_| "（无描述）".to_string());
    let channels = read_skill_config_channels(&root);
    out.push(SkillMeta {
      name: item.name.clone(),
      description,
      source: item.source.clone(),
      enabled: item.enabled,
      updated_at: item.updated_at,
      applicable_channels: channels,
    });
  }

  out.sort_by(|a, b| a.name.cmp(&b.name));
  Ok(out)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSkillRequest {
  pub name: String,
  pub content: String,
  #[serde(default)]
  pub config: serde_json::Value,
}

fn validate_skill_markdown_for_folder(name: &str, content: &str) -> Result<(), String> {
  let (fm, _) = parse_skill_frontmatter(content);
  let fm_name = fm
    .name
    .ok_or_else(|| "SKILL.md 头部缺少 name 字段".to_string())?;
  if fm_name != name {
    return Err(format!(
      "SKILL.md 中的 name（{}）必须与技能目录名（{}）一致",
      fm_name, name
    ));
  }
  if fm.description.as_ref().map(|s| s.trim().is_empty()).unwrap_or(true) {
    return Err("SKILL.md 头部缺少 description 或描述为空".to_string());
  }
  Ok(())
}

fn skill_root_for_name(name: &str) -> Result<PathBuf, String> {
  let n = name.trim();
  validate_skill_name(n)?;
  let builtin_root = skills_builtin_dir()?;
  let custom_root = skills_custom_dir()?;
  let b = builtin_root.join(n);
  let c = custom_root.join(n);
  if c.is_dir() && has_skill_md(&c) {
    return Ok(c);
  }
  if b.is_dir() && has_skill_md(&b) {
    return Ok(b);
  }
  Err(format!("未找到技能: {}", n))
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SkillContentPayload {
  pub name: String,
  pub content: String,
}

pub fn get_skill_content(name: &str) -> Result<SkillContentPayload, String> {
  let root = skill_root_for_name(name)?;
  let path = skill_md_path_in_dir(&root).ok_or_else(|| "SKILL.md 缺失".to_string())?;
  let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
  Ok(SkillContentPayload {
    name: name.trim().to_string(),
    content,
  })
}

pub fn save_skill_content(name: &str, content: &str) -> Result<(), String> {
  let n = name.trim();
  validate_skill_name(n)?;
  validate_skill_markdown_for_folder(n, content)?;
  let root = skill_root_for_name(n)?;
  let out = skill_md_path_in_dir(&root).unwrap_or_else(|| root.join("SKILL.md"));
  fs::write(out, content).map_err(|e| e.to_string())?;
  let builtin_root = skills_builtin_dir()?;
  let custom_root = skills_custom_dir()?;
  let mut state = load_skills_state()?;
  merge_state_with_disk(&mut state, &builtin_root, &custom_root)?;
  save_skills_state(&state)?;
  Ok(())
}

pub fn create_skill(req: CreateSkillRequest) -> Result<(), String> {
  let name = req.name.trim().to_string();
  validate_skill_name(&name)?;
  let builtin_root = skills_builtin_dir()?;
  let custom_root = skills_custom_dir()?;
  fs::create_dir_all(&builtin_root).map_err(|e| e.to_string())?;
  fs::create_dir_all(&custom_root).map_err(|e| e.to_string())?;

  bootstrap_builtin_skills()?;

  let names = collect_skill_name_set(&builtin_root, &custom_root)?;
  if names.contains(&name) {
    return Err(format!("技能名称已存在: {}", name));
  }

  validate_skill_markdown_for_folder(&name, &req.content)?;

  let dest = custom_root.join(&name);
  if dest.exists() {
    return Err(format!("技能名称已存在: {}", name));
  }
  fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
  fs::write(dest.join("SKILL.md"), req.content).map_err(|e| e.to_string())?;

  if !req.config.is_null() && req.config != serde_json::json!({}) {
    let cfg_str = serde_json::to_string_pretty(&req.config).map_err(|e| e.to_string())?;
    fs::write(dest.join("config.json"), cfg_str+ "\n").map_err(|e| e.to_string())?;
  }

  let mut state = load_skills_state()?;
  merge_state_with_disk(&mut state, &builtin_root, &custom_root)?;
  save_skills_state(&state)?;
  Ok(())
}

pub fn set_skill_enabled(name: &str, enabled: bool) -> Result<(), String> {
  let n = name.trim();
  if n.is_empty() {
    return Err("技能名称不能为空".to_string());
  }
  let builtin_root = skills_builtin_dir()?;
  let custom_root = skills_custom_dir()?;
  let mut state = load_skills_state()?;
  merge_state_with_disk(&mut state, &builtin_root, &custom_root)?;

  let mut found = false;
  for item in &mut state.items {
    if item.name == n {
      item.enabled = enabled;
      found = true;
      break;
    }
  }
  if !found {
    return Err(format!("未找到技能: {}", n));
  }
  save_skills_state(&state)?;
  Ok(())
}

pub fn delete_skill(name: &str) -> Result<(), String> {
  let n = name.trim();
  if n.is_empty() {
    return Err("技能名称不能为空".to_string());
  }
  let builtin_root = skills_builtin_dir()?;
  let custom_root = skills_custom_dir()?;
  let target = custom_root.join(n);
  if !target.is_dir() {
    return Err("只能删除用户自定义技能，或未找到该技能".to_string());
  }
  // refuse if it's under builtin (should not happen if name matches)
  if target.strip_prefix(&builtin_root).is_ok() && builtin_root.join(n).exists() {
    // If same name exists in builtin, custom path check: custom_root.join(n) is the only custom
  }
  remove_dir_all(&target)?;

  let mut state = load_skills_state()?;
  merge_state_with_disk(&mut state, &builtin_root, &custom_root)?;
  save_skills_state(&state)?;
  Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSkillsZipResult {
  pub imported: Vec<String>,
}

fn is_safe_zip_rel_path(name: &str) -> bool {
  let n = name.replace('\\', "/").trim_start_matches('/').to_string();
  if n.is_empty() {
    return false;
  }
  !n.split('/').any(|p| p == "..")
}

fn safe_zip_out_path(destination: &Path, name: &str) -> Result<PathBuf, String> {
  if !is_safe_zip_rel_path(name) {
    return Err("ZIP 内包含非法路径".to_string());
  }
  let path = destination.join(name.replace('\\', "/"));
  Ok(path)
}

fn extract_zip(bytes: &[u8], dest: &Path) -> Result<(), String> {
  fs::create_dir_all(dest).map_err(|e| e.to_string())?;
  let reader = Cursor::new(bytes);
  let mut archive = zip::ZipArchive::new(reader).map_err(|e| format!("无法读取 ZIP：{}", e))?;

  for i in 0..archive.len() {
    let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
    let name = file.name();
    if name.contains("..") {
      return Err("ZIP 内包含非法路径".to_string());
    }
    let outpath = safe_zip_out_path(dest, name)?;

    if file.name().ends_with('/') || file.is_dir() {
      fs::create_dir_all(&outpath).map_err(|e| e.to_string())?;
    } else {
      if let Some(parent) = outpath.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
      }
      let mut outfile = fs::File::create(&outpath).map_err(|e| e.to_string())?;
      std::io::copy(&mut file, &mut outfile).map_err(|e| e.to_string())?;
    }
  }
  Ok(())
}

/// Locate packaged skills after unzip: `name/SKILL.md`, optional single wrapper dir, or flat `SKILL.md` at extract root.
fn find_skill_roots_in_extract(extract_root: &Path) -> Result<Vec<PathBuf>, String> {
  let entries = read_zip_extract_entries(extract_root)?;

  let mut candidates: Vec<PathBuf> = entries
    .iter()
    .filter_map(|e| {
      let p = e.path();
      if p.is_dir() && has_skill_md(&p) {
        Some(p)
      } else {
        None
      }
    })
    .collect();

  if candidates.is_empty() && entries.len() == 1 {
    let only = entries[0].path();
    if only.is_dir() && !has_skill_md(&only) {
      return find_skill_roots_in_extract(&only);
    }
  }

  if candidates.is_empty() && has_skill_md(extract_root) {
    candidates.push(extract_root.to_path_buf());
  }

  if candidates.is_empty() {
    return Err(
      "ZIP 中未找到技能：请在子文件夹中放置 SKILL.md，或在 ZIP 根目录直接放置 SKILL.md（如 weather-1.0.0.zip 内一层目录或扁平打包均可）".to_string(),
    );
  }
  Ok(candidates)
}

/// Returns canonical skill id from YAML `name` (install dir under customized_skills). Folder basename may be e.g. `weather-1.0.0` or a temp dir when flat-importing.
fn validate_skill_dir_for_import(folder: &Path, extract_root: &Path) -> Result<String, String> {
  let skill_md = skill_md_path_in_dir(folder)
    .ok_or_else(|| "目录中未找到 SKILL.md（支持 SKILL.md / skill.md）".to_string())?;
  let raw = fs::read_to_string(&skill_md).map_err(|e| e.to_string())?;
  let (fm, _) = parse_skill_frontmatter(&raw);
  let fm_name = fm
    .name
    .map(|s| s.trim().to_string())
    .filter(|s| !s.is_empty())
    .ok_or_else(|| "SKILL.md 头部缺少 name".to_string())?;
  validate_skill_name(&fm_name)?;
  if fm.description.as_ref().map(|s| s.trim().is_empty()).unwrap_or(true) {
    return Err("SKILL.md 头部缺少 description 或描述为空".to_string());
  }

  let dir_name = folder
    .file_name()
    .and_then(|s| s.to_str())
    .unwrap_or("");

  let is_flat_root = folder == extract_root;
  let dir_is_valid_id = validate_skill_name(dir_name).is_ok();

  if dir_is_valid_id && !is_flat_root && dir_name != fm_name {
    return Err(format!(
      "技能文件夹名 {} 与 SKILL.md 中的 name（{}）不一致",
      dir_name, fm_name
    ));
  }

  Ok(fm_name)
}

pub fn import_skills_zip_base64(zip_base64: &str) -> Result<ImportSkillsZipResult, String> {
  let trimmed = zip_base64.trim();
  if trimmed.is_empty() {
    return Err("ZIP 内容为空".to_string());
  }
  let bytes = base64::engine::general_purpose::STANDARD
    .decode(trimmed)
    .map_err(|e| format!("Base64 解码失败：{}", e))?;

  let builtin_root = skills_builtin_dir()?;
  let custom_root = skills_custom_dir()?;
  fs::create_dir_all(&builtin_root).map_err(|e| e.to_string())?;
  fs::create_dir_all(&custom_root).map_err(|e| e.to_string())?;
  bootstrap_builtin_skills()?;

  let temp = std::env::temp_dir().join(format!("tental_skills_zip_{}", now_ms()));
  if temp.exists() {
    remove_dir_all(&temp)?;
  }
  fs::create_dir_all(&temp).map_err(|e| e.to_string())?;

  let res = (|| -> Result<ImportSkillsZipResult, String> {
    extract_zip(&bytes, &temp)?;
    let temp_canon = fs::canonicalize(&temp).unwrap_or_else(|_| temp.clone());
    let roots = find_skill_roots_in_extract(&temp)?;

    let mut packs: Vec<(PathBuf, String)> = Vec::new();
    for r in roots {
      let r_canon = fs::canonicalize(&r).unwrap_or(r.clone());
      let canonical = validate_skill_dir_for_import(&r_canon, &temp_canon)?;
      packs.push((r_canon, canonical));
    }

    let import_names: Vec<String> = packs.iter().map(|(_, n)| n.clone()).collect();
    let unique: HashSet<String> = import_names.iter().cloned().collect();
    if unique.len() != import_names.len() {
      return Err("ZIP 内含重名技能（多个目录对应同一 YAML name）".to_string());
    }

    let existing = collect_skill_name_set(&builtin_root, &custom_root)?;
    for n in &import_names {
      if existing.contains(n) {
        return Err(format!("与已有技能重名，已取消导入: {}", n));
      }
    }

    for (src, name) in packs {
      let dest = custom_root.join(&name);
      copy_dir_all(&src, &dest)?;
    }

    let mut state = load_skills_state()?;
    merge_state_with_disk(&mut state, &builtin_root, &custom_root)?;
    save_skills_state(&state)?;

    Ok(ImportSkillsZipResult { imported: import_names })
  })();

  let _ = remove_dir_all(&temp);
  res
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn validate_skill_name_accepts_lower_snake() {
    assert!(validate_skill_name("weather_query").is_ok());
    assert!(validate_skill_name("a-b").is_ok());
  }

  #[test]
  fn validate_skill_name_rejects_upper() {
    assert!(validate_skill_name("Weather").is_err());
  }

  #[test]
  fn parse_frontmatter_extracts_name_description() {
    let raw = "---\nname: foo\ndescription: bar baz\n---\n\nHello";
    let (fm, body) = parse_skill_frontmatter(raw);
    assert_eq!(fm.name.as_deref(), Some("foo"));
    assert_eq!(fm.description.as_deref(), Some("bar baz"));
    assert!(body.contains("Hello"));
  }

  #[test]
  fn find_roots_flat_skill_md_at_extract_root() {
    let dir = std::env::temp_dir().join(format!("tental_skill_zip_flat_{}", now_ms()));
    let _ = remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("SKILL.md"), "---\nname: x\ndescription: d\n---\n").unwrap();
    let roots = find_skill_roots_in_extract(&dir).unwrap();
    assert_eq!(roots.len(), 1);
    assert_eq!(roots[0], dir);
    let _ = remove_dir_all(&dir);
  }

  #[test]
  fn find_roots_versioned_outer_folder() {
    let dir = std::env::temp_dir().join(format!("tental_skill_zip_ver_{}", now_ms()));
    let _ = remove_dir_all(&dir);
    let inner = dir.join("weather-1.0.0");
    fs::create_dir_all(&inner).unwrap();
    fs::write(inner.join("SKILL.md"), "---\nname: w\ndescription: d\n---\n").unwrap();
    let roots = find_skill_roots_in_extract(&dir).unwrap();
    assert_eq!(roots.len(), 1);
    assert_eq!(roots[0], inner);
    let _ = remove_dir_all(&dir);
  }

  #[test]
  fn validate_import_uses_yaml_name_when_folder_has_dots() {
    let dir = std::env::temp_dir().join(format!("tental_val_{}", now_ms()));
    let _ = remove_dir_all(&dir);
    let inner = dir.join("weather-1.0.0");
    fs::create_dir_all(&inner).unwrap();
    fs::write(
      inner.join("SKILL.md"),
      "---\nname: weather\ndescription: test\n---\n\nbody",
    )
    .unwrap();
    let temp = fs::canonicalize(&dir).unwrap();
    let inner_c = fs::canonicalize(&inner).unwrap();
    let n = validate_skill_dir_for_import(&inner_c, &temp).unwrap();
    assert_eq!(n, "weather");
    let _ = remove_dir_all(&dir);
  }
}
