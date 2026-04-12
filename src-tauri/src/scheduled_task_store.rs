use chrono::{DateTime, Datelike, Duration, Local, LocalResult, NaiveTime, TimeZone, Weekday};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::PathBuf;

use crate::get_tental_dir_path;
use crate::workflow_store::WorkflowRunRecord;

fn scheduled_task_store_path() -> Result<PathBuf, String> {
  Ok(get_tental_dir_path()?.join("scheduled-tasks-store.json"))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum TaskSchedule {
  #[serde(rename = "daily")]
  Daily {
    hour: u8,
    minute: u8,
  },
  #[serde(rename = "weekly")]
  Weekly {
    hour: u8,
    minute: u8,
    /// 0 = Sunday … 6 = Saturday (same as JS `Date.getDay()`).
    #[serde(default)]
    weekdays: Vec<u8>,
  },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledTask {
  pub id: String,
  pub name: String,
  #[serde(default = "default_true")]
  pub enabled: bool,
  pub workflow_id: String,
  #[serde(default)]
  pub workflow_name_snapshot: String,
  #[serde(default)]
  pub start_inputs: Value,
  pub schedule: TaskSchedule,
  #[serde(default)]
  pub last_run_at: Option<i64>,
  #[serde(default)]
  pub last_run_status: Option<String>,
  /// Slot key last successfully triggered for schedule (dedupe across poll ticks).
  #[serde(default)]
  pub last_fired_slot: Option<String>,
  /// True while a run is in progress (manual or scheduler).
  #[serde(default)]
  pub running: bool,
  pub created_at: i64,
  pub updated_at: i64,
}

fn default_true() -> bool {
  true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledTaskRun {
  pub id: String,
  pub task_id: String,
  pub task_name_snapshot: String,
  pub workflow_id: String,
  pub workflow_run_id: String,
  /// `schedule` | `manual`
  pub trigger: String,
  pub started_at: i64,
  pub finished_at: i64,
  pub status: String,
  #[serde(default)]
  pub output_text: String,
  #[serde(default)]
  pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledTaskStore {
  #[serde(default)]
  pub tasks: Vec<ScheduledTask>,
  #[serde(default)]
  pub runs: Vec<ScheduledTaskRun>,
}

pub fn load_scheduled_task_store_disk() -> Result<ScheduledTaskStore, String> {
  let path = scheduled_task_store_path()?;
  if !path.exists() {
    return Ok(ScheduledTaskStore::default());
  }
  let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
  serde_json::from_str::<ScheduledTaskStore>(&content).map_err(|e| e.to_string())
}

pub fn save_scheduled_task_store_disk(store: &ScheduledTaskStore) -> Result<(), String> {
  let path = scheduled_task_store_path()?;
  let content = serde_json::to_string_pretty(store).map_err(|e| e.to_string())?;
  fs::write(path, content).map_err(|e| e.to_string())
}

/// Map chrono weekday (Mon=0 … Sun=6) to JS-style (Sun=0 … Sat=6).
pub fn js_weekday_from_chrono(w: Weekday) -> u8 {
  match w {
    Weekday::Sun => 0,
    Weekday::Mon => 1,
    Weekday::Tue => 2,
    Weekday::Wed => 3,
    Weekday::Thu => 4,
    Weekday::Fri => 5,
    Weekday::Sat => 6,
  }
}

/// Most recent schedule instant `slot_dt <= now`, with stable `slot_key`.
pub fn current_due_slot(now: DateTime<Local>, schedule: &TaskSchedule) -> Option<(String, DateTime<Local>)> {
  match schedule {
    TaskSchedule::Daily { hour, minute } => {
      let t = naive_hm(*hour, *minute)?;
      let today = now.date_naive();
      let today_slot = today.and_time(t);
      if let Some(today_dt) = naive_to_local(today_slot) {
        if today_dt <= now {
          return Some((
            format!("daily:{}", today_slot.format("%Y-%m-%d %H:%M")),
            today_dt,
          ));
        }
      }
      let y = today.pred_opt()?;
      let y_slot = y.and_time(t);
      let dt = naive_to_local(y_slot)?;
      Some((format!("daily:{}", y_slot.format("%Y-%m-%d %H:%M")), dt))
    }
    TaskSchedule::Weekly {
      hour,
      minute,
      weekdays,
    } => {
      let t = naive_hm(*hour, *minute)?;
      let days: Vec<u8> = if weekdays.is_empty() {
        (0..7).collect()
      } else {
        weekdays.clone()
      };
      for back in 0_i64..=(7 * 8) {
        let d = now.date_naive() - Duration::days(back);
        let wd = js_weekday_from_chrono(d.weekday());
        if !days.contains(&wd) {
          continue;
        }
        let cand = d.and_time(t);
        let Some(dt) = naive_to_local(cand) else {
          continue;
        };
        if dt <= now {
          return Some((format!("weekly:{}", cand.format("%Y-%m-%d %H:%M")), dt));
        }
      }
      None
    }
  }
}

/// Grace after `slot_dt` within which a scheduled run still fires; after that the slot is skipped.
pub const SCHEDULE_FIRE_GRACE: Duration = Duration::seconds(90);

fn naive_hm(hour: u8, minute: u8) -> Option<NaiveTime> {
  NaiveTime::from_hms_opt(hour as u32, minute as u32, 0)
}

fn naive_to_local(ndt: chrono::NaiveDateTime) -> Option<chrono::DateTime<Local>> {
  match Local.from_local_datetime(&ndt) {
    LocalResult::Single(dt) => Some(dt),
    LocalResult::Ambiguous(a, _) => Some(a),
    LocalResult::None => None,
  }
}

pub fn outputs_to_output_text(outputs: &Value) -> String {
  match outputs {
    Value::String(s) => s.clone(),
    Value::Null => String::new(),
    other => serde_json::to_string_pretty(other).unwrap_or_else(|_| other.to_string()),
  }
}

pub fn append_task_run_and_update_task(
  store: &mut ScheduledTaskStore,
  task_id: &str,
  run: &WorkflowRunRecord,
  trigger: &str,
  now_ms: i64,
) -> Result<ScheduledTaskRun, String> {
  let task = store
    .tasks
    .iter_mut()
    .find(|t| t.id == task_id)
    .ok_or_else(|| "任务不存在".to_string())?;
  let output_text = outputs_to_output_text(&run.outputs);
  let rec = ScheduledTaskRun {
    id: run.id.clone(),
    task_id: task.id.clone(),
    task_name_snapshot: task.name.clone(),
    workflow_id: run.workflow_id.clone(),
    workflow_run_id: run.id.clone(),
    trigger: trigger.to_string(),
    started_at: run.started_at,
    finished_at: run.finished_at,
    status: run.status.clone(),
    output_text,
    error: run.error.clone(),
  };
  store.runs.push(rec.clone());
  task.last_run_at = Some(run.finished_at);
  task.last_run_status = Some(run.status.clone());
  task.updated_at = now_ms;
  Ok(rec)
}
