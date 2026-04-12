import { invoke } from '@tauri-apps/api/core'

export type TaskSchedule =
  | { kind: 'daily'; hour: number; minute: number }
  | { kind: 'weekly'; hour: number; minute: number; weekdays: number[] }

export type ScheduledTask = {
  id: string
  name: string
  enabled: boolean
  workflowId: string
  workflowNameSnapshot: string
  startInputs: Record<string, unknown>
  schedule: TaskSchedule
  lastRunAt?: number
  lastRunStatus?: string
  lastFiredSlot?: string
  running: boolean
  createdAt: number
  updatedAt: number
}

export type ScheduledTaskRun = {
  id: string
  taskId: string
  taskNameSnapshot: string
  workflowId: string
  workflowRunId: string
  trigger: string
  startedAt: number
  finishedAt: number
  status: string
  outputText: string
  error?: string
}

export type ScheduledTaskStoreData = {
  tasks: ScheduledTask[]
  runs: ScheduledTaskRun[]
}

export async function loadScheduledTaskStore(): Promise<ScheduledTaskStoreData> {
  const raw = await invoke<ScheduledTaskStoreData>('load_scheduled_task_store')
  return {
    tasks: Array.isArray(raw.tasks) ? raw.tasks : [],
    runs: Array.isArray(raw.runs) ? raw.runs : [],
  }
}

export async function saveScheduledTaskStore(store: ScheduledTaskStoreData): Promise<void> {
  await invoke('save_scheduled_task_store', { store })
}

export async function runScheduledTaskNow(taskId: string): Promise<ScheduledTaskRun> {
  return invoke<ScheduledTaskRun>('run_scheduled_task_now', { taskId })
}

export function scheduleSummaryZh(s: TaskSchedule): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const timePart = (hour: number, minute: number) => {
    const ap = hour < 12 ? '上午' : '下午'
    const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour
    return `${ap}${h12}:${pad(minute)}`
  }
  if (s.kind === 'daily') {
    return `每天${timePart(s.hour, s.minute)}`
  }
  const labels = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  const days = (s.weekdays?.length ? s.weekdays : [0, 1, 2, 3, 4, 5, 6])
    .map((d) => labels[d % 7])
    .filter((x, i, a) => a.indexOf(x) === i)
  if (days.length === 7) {
    return `每周${timePart(s.hour, s.minute)}`
  }
  return `每${days.join('、')}${timePart(s.hour, s.minute)}`
}

export function parseTimeToHm(value: string): { hour: number; minute: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!m) return null
  const hour = Number(m[1])
  const minute = Number(m[2])
  if (hour > 23 || minute > 59) return null
  return { hour, minute }
}

export function hmToTimeValue(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}
