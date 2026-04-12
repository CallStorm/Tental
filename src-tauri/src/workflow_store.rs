use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::PathBuf;

use crate::get_tental_dir_path;

fn workflow_store_path() -> Result<PathBuf, String> {
  Ok(get_tental_dir_path()?.join("workflow-store.json"))
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowStore {
  #[serde(default)]
  pub workflows: Vec<WorkflowDefinition>,
  #[serde(default)]
  pub runs: Vec<WorkflowRunRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowDefinition {
  pub id: String,
  pub name: String,
  pub created_at: i64,
  pub updated_at: i64,
  pub graph: WorkflowGraph,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowGraph {
  #[serde(default)]
  pub nodes: Vec<WorkflowNode>,
  #[serde(default)]
  pub edges: Vec<WorkflowEdge>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowEdge {
  pub id: String,
  pub source: String,
  pub target: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowNode {
  pub id: String,
  #[serde(rename = "type")]
  pub node_type: String,
  pub position: NodePosition,
  #[serde(default)]
  pub data: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodePosition {
  pub x: f64,
  pub y: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowRunRecord {
  pub id: String,
  pub workflow_id: String,
  #[serde(default)]
  pub workflow_name_snapshot: String,
  pub started_at: i64,
  pub finished_at: i64,
  #[serde(default)]
  pub status: String,
  /// User inputs from the start node (JSON object).
  #[serde(default)]
  pub input: Value,
  /// Final output from the end node mapping.
  #[serde(default)]
  pub outputs: Value,
  #[serde(default)]
  pub step_logs: Vec<WorkflowStepLog>,
  #[serde(default)]
  pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowStepLog {
  pub node_id: String,
  #[serde(rename = "type")]
  pub node_type: String,
  pub started_at: i64,
  pub finished_at: i64,
  #[serde(default)]
  pub ok: bool,
  #[serde(default)]
  pub detail: Option<String>,
  #[serde(default)]
  pub output_preview: Option<String>,
}

pub fn load_workflow_store_disk() -> Result<WorkflowStore, String> {
  let path = workflow_store_path()?;
  if !path.exists() {
    return Ok(WorkflowStore::default());
  }
  let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
  serde_json::from_str::<WorkflowStore>(&content).map_err(|e| e.to_string())
}

pub fn save_workflow_store_disk(store: &WorkflowStore) -> Result<(), String> {
  let path = workflow_store_path()?;
  let content = serde_json::to_string_pretty(store).map_err(|e| e.to_string())?;
  fs::write(path, content).map_err(|e| e.to_string())
}
