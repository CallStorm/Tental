use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

use crate::get_tental_dir_path;

fn evaluation_store_path() -> Result<PathBuf, String> {
    Ok(get_tental_dir_path()?.join("evaluation-store.json"))
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct EvaluationStore {
    #[serde(default)]
    pub suites: Vec<EvaluationSuite>,
    #[serde(default)]
    pub runs: Vec<EvaluationRun>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvaluationSuite {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(default)]
    pub cases: Vec<EvaluationCase>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvaluationCase {
    pub id: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    pub order: i32,
    pub prompt: String,
    pub expected: String,
    #[serde(default)]
    pub rubric: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvaluationRun {
    pub id: String,
    pub suite_id: String,
    #[serde(default)]
    pub suite_name_snapshot: String,
    pub started_at: i64,
    pub finished_at: i64,
    #[serde(default)]
    pub items: Vec<EvaluationRunItem>,
    #[serde(default)]
    pub summary: EvaluationRunSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct EvaluationRunSummary {
    #[serde(default)]
    pub total: u32,
    #[serde(default)]
    pub passed: u32,
    #[serde(default)]
    pub failed: u32,
    #[serde(default)]
    pub avg_score: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct EvaluationRunItem {
    pub case_id: String,
    pub prompt: String,
    pub expected: String,
    #[serde(default)]
    pub final_answer: String,
    #[serde(default)]
    pub thinking: Option<String>,
    #[serde(default)]
    pub debug_logs: Vec<String>,
    #[serde(default)]
    pub tool_traces: Vec<String>,
    #[serde(default)]
    pub score: i32,
    #[serde(default)]
    pub pass: bool,
    #[serde(default)]
    pub reason: String,
    #[serde(default)]
    pub diff_highlights: Vec<String>,
    #[serde(default)]
    pub error: Option<String>,
}

pub fn load_evaluation_store_disk() -> Result<EvaluationStore, String> {
    let path = evaluation_store_path()?;
    if !path.exists() {
        return Ok(EvaluationStore::default());
    }
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

pub fn save_evaluation_store_disk(store: &EvaluationStore) -> Result<(), String> {
    let path = evaluation_store_path()?;
    let content = serde_json::to_string_pretty(store).map_err(|e| e.to_string())?;
    fs::write(path, content).map_err(|e| e.to_string())
}
