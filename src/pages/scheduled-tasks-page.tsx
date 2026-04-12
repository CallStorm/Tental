import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlarmClock, CalendarDays, Clock3, MoreHorizontal, Plus } from 'lucide-react'
import { ChatMarkdown } from '@/components/chat-markdown'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import {
  hmToTimeValue,
  loadScheduledTaskStore,
  parseTimeToHm,
  runScheduledTaskNow,
  saveScheduledTaskStore,
  scheduleSummaryZh,
  type ScheduledTask,
  type ScheduledTaskRun,
  type ScheduledTaskStoreData,
  type TaskSchedule,
} from '@/lib/scheduled-tasks-api'
import { loadWorkflowStore, type WorkflowDefinition } from '@/lib/workflow-api'
import { startParamsOf } from '@/lib/workflow-graph'
import { cn } from '@/lib/utils'

type Tab = 'list' | 'history'

type ModalState =
  | { kind: 'create' }
  | { kind: 'edit'; task: ScheduledTask }
  | null

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六']

function nowMs() {
  return Date.now()
}

function toYmd(ms: number): string {
  const d = new Date(ms)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function formatYmdSlash(ymd: string): string {
  const [y, m, d] = ymd.split('-')
  return `${y}/${m}/${d}`
}

function isTodayYmd(ymd: string): boolean {
  return ymd === toYmd(Date.now())
}

function formatLastRun(ms: number): string {
  const d = new Date(ms)
  const t = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  if (isTodayYmd(toYmd(ms))) {
    return `今天 ${t}`
  }
  return `${d.getMonth() + 1}/${d.getDate()} ${t}`
}

function inputsPreview(inputs: Record<string, unknown>, max = 96): string {
  const parts = Object.entries(inputs).map(([k, v]) => `${k}: ${String(v)}`)
  const s = parts.join(' · ')
  if (s.length <= max) return s
  return `${s.slice(0, max)}…`
}

function emptyFormFromWorkflow(wf: WorkflowDefinition | null) {
  const inputs: Record<string, string> = {}
  if (wf) {
    for (const p of startParamsOf(wf)) {
      inputs[p.name] = ''
    }
  }
  return {
    name: '',
    workflowId: wf?.id ?? '',
    startInputs: inputs,
    scheduleKind: 'daily' as 'daily' | 'weekly',
    timeValue: '08:00',
    weekdays: new Set<number>([1, 2, 3, 4, 5]),
  }
}

function formToSchedule(
  scheduleKind: 'daily' | 'weekly',
  timeValue: string,
  weekdays: Set<number>,
): TaskSchedule | null {
  const hm = parseTimeToHm(timeValue)
  if (!hm) return null
  if (scheduleKind === 'daily') {
    return { kind: 'daily', hour: hm.hour, minute: hm.minute }
  }
  const wd = [...weekdays].sort((a, b) => a - b)
  return { kind: 'weekly', hour: hm.hour, minute: hm.minute, weekdays: wd }
}

function taskToForm(task: ScheduledTask, wf: WorkflowDefinition | null) {
  const base = emptyFormFromWorkflow(wf)
  const inputs = { ...base.startInputs }
  for (const [k, v] of Object.entries(task.startInputs ?? {})) {
    inputs[k] = v == null ? '' : String(v)
  }
  const sch = task.schedule
  const timeValue =
    sch.kind === 'daily'
      ? hmToTimeValue(sch.hour, sch.minute)
      : hmToTimeValue(sch.hour, sch.minute)
  const weekdays =
    sch.kind === 'weekly' && sch.weekdays?.length
      ? new Set(sch.weekdays)
      : new Set([0, 1, 2, 3, 4, 5, 6])
  return {
    name: task.name,
    workflowId: task.workflowId,
    startInputs: inputs,
    scheduleKind: sch.kind === 'weekly' ? ('weekly' as const) : ('daily' as const),
    timeValue,
    weekdays,
  }
}

export function ScheduledTasksPage() {
  const [tab, setTab] = useState<Tab>('list')
  const [store, setStore] = useState<ScheduledTaskStoreData | null>(null)
  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([])
  const [hint, setHint] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [modal, setModal] = useState<ModalState>(null)
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null)
  const [historyTaskId, setHistoryTaskId] = useState('')
  const [historyDate, setHistoryDate] = useState('')

  const [formName, setFormName] = useState('')
  const [formWorkflowId, setFormWorkflowId] = useState('')
  const [formStartInputs, setFormStartInputs] = useState<Record<string, string>>({})
  const [formScheduleKind, setFormScheduleKind] = useState<'daily' | 'weekly'>('daily')
  const [formTimeValue, setFormTimeValue] = useState('08:00')
  const [formWeekdays, setFormWeekdays] = useState<Set<number>>(() => new Set([1, 2, 3, 4, 5]))

  const reload = useCallback(async () => {
    const [s, wf] = await Promise.all([loadScheduledTaskStore(), loadWorkflowStore()])
    setStore(s)
    setWorkflows(wf.workflows ?? [])
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const wfById = useMemo(() => {
    const m = new Map<string, WorkflowDefinition>()
    for (const w of workflows) m.set(w.id, w)
    return m
  }, [workflows])

  const persist = useCallback(async (next: ScheduledTaskStoreData) => {
    setStore(next)
    await saveScheduledTaskStore(next)
  }, [])

  const openCreate = () => {
    const first = workflows[0] ?? null
    const f = emptyFormFromWorkflow(first)
    setFormName(f.name)
    setFormWorkflowId(f.workflowId)
    setFormStartInputs(f.startInputs)
    setFormScheduleKind(f.scheduleKind)
    setFormTimeValue(f.timeValue)
    setFormWeekdays(f.weekdays)
    setModal({ kind: 'create' })
  }

  const openEdit = (task: ScheduledTask) => {
    const wf = wfById.get(task.workflowId) ?? null
    const f = taskToForm(task, wf)
    setFormName(f.name)
    setFormWorkflowId(f.workflowId)
    setFormStartInputs(f.startInputs)
    setFormScheduleKind(f.scheduleKind)
    setFormTimeValue(f.timeValue)
    setFormWeekdays(f.weekdays)
    setModal({ kind: 'edit', task })
    setMenuOpenId(null)
  }

  const onWorkflowPick = (id: string) => {
    setFormWorkflowId(id)
    const wf = wfById.get(id) ?? null
    const f = emptyFormFromWorkflow(wf)
    setFormStartInputs(f.startInputs)
  }

  const submitModal = async () => {
    if (!store) return
    const wf = wfById.get(formWorkflowId)
    if (!formName.trim()) {
      setHint('请填写任务名称')
      return
    }
    if (!wf) {
      setHint('请选择工作流')
      return
    }
    const params = startParamsOf(wf)
    const startInputs: Record<string, unknown> = {}
    for (const p of params) {
      const v = formStartInputs[p.name]?.trim() ?? ''
      if (!v && p.required) {
        setHint(`请填写参数：${p.name}`)
        return
      }
      startInputs[p.name] = v
    }
    const schedule = formToSchedule(formScheduleKind, formTimeValue, formWeekdays)
    if (!schedule) {
      setHint('执行时间格式不正确')
      return
    }
    if (schedule.kind === 'weekly' && schedule.weekdays.length === 0) {
      setHint('每周执行请至少选择一天')
      return
    }
    const t = nowMs()
    if (modal?.kind === 'create') {
      const task: ScheduledTask = {
        id: crypto.randomUUID(),
        name: formName.trim(),
        enabled: true,
        workflowId: wf.id,
        workflowNameSnapshot: wf.name,
        startInputs,
        schedule,
        running: false,
        createdAt: t,
        updatedAt: t,
      }
      await persist({ ...store, tasks: [task, ...store.tasks] })
      setHint('已创建任务')
    } else if (modal?.kind === 'edit') {
      const prev = modal.task
      const nextTasks = store.tasks.map((x) =>
        x.id === prev.id
          ? {
              ...x,
              name: formName.trim(),
              workflowId: wf.id,
              workflowNameSnapshot: wf.name,
              startInputs,
              schedule,
              updatedAt: t,
            }
          : x,
      )
      await persist({ ...store, tasks: nextTasks })
      setHint('已保存')
    }
    setModal(null)
  }

  const deleteTask = async (task: ScheduledTask) => {
    if (!store || !window.confirm(`删除任务「${task.name}」？`)) return
    await persist({
      ...store,
      tasks: store.tasks.filter((t) => t.id !== task.id),
    })
    setHint('已删除')
    setMenuOpenId(null)
  }

  const setTaskEnabled = async (task: ScheduledTask, enabled: boolean) => {
    if (!store) return
    const t = nowMs()
    await persist({
      ...store,
      tasks: store.tasks.map((x) => (x.id === task.id ? { ...x, enabled, updatedAt: t } : x)),
    })
  }

  const doRunNow = async (task: ScheduledTask) => {
    setBusyId(task.id)
    setHint(null)
    setMenuOpenId(null)
    try {
      await runScheduledTaskNow(task.id)
      setHint('已执行')
      await reload()
    } catch (e) {
      setHint(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyId(null)
    }
  }

  const sortedTasks = useMemo(
    () => [...(store?.tasks ?? [])].sort((a, b) => b.updatedAt - a.updatedAt),
    [store],
  )

  const historyDates = useMemo(() => {
    const set = new Set<string>()
    for (const r of store?.runs ?? []) {
      set.add(toYmd(r.startedAt))
    }
    return [...set].sort((a, b) => b.localeCompare(a))
  }, [store])

  const filteredRuns = useMemo(() => {
    let list: ScheduledTaskRun[] = [...(store?.runs ?? [])]
    if (historyTaskId) {
      list = list.filter((r) => r.taskId === historyTaskId)
    }
    if (historyDate) {
      list = list.filter((r) => toYmd(r.startedAt) === historyDate)
    }
    list.sort((a, b) => b.startedAt - a.startedAt)
    return list
  }, [store, historyTaskId, historyDate])

  const runsByDate = useMemo(() => {
    const m = new Map<string, ScheduledTaskRun[]>()
    for (const r of filteredRuns) {
      const k = toYmd(r.startedAt)
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(r)
    }
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  }, [filteredRuns])

  const taskOptions = useMemo(
    () => [
      { value: '', label: '全部任务记录' },
      ...sortedTasks.map((t) => ({ value: t.id, label: t.name })),
    ],
    [sortedTasks],
  )

  const dateOptions = useMemo(
    () => [
      { value: '', label: '全部日期' },
      ...historyDates.map((d) => ({ value: d, label: formatYmdSlash(d) })),
    ],
    [historyDates],
  )

  const formWf = formWorkflowId ? wfById.get(formWorkflowId) ?? null : null

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Clock3 className="h-6 w-6 text-slate-600" />
          <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">定时任务</h1>
        </div>
        {tab === 'list' ? (
          <Button type="button" size="sm" onClick={() => openCreate()} disabled={workflows.length === 0}>
            <Plus className="mr-1 h-4 w-4" />
            添加
          </Button>
        ) : null}
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setTab('list')}
          className={cn(
            'rounded-full px-4 py-1.5 text-sm font-medium transition',
            tab === 'list'
              ? 'bg-slate-200 text-slate-900 dark:bg-slate-700 dark:text-slate-100'
              : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800',
          )}
        >
          任务列表
        </button>
        <button
          type="button"
          onClick={() => setTab('history')}
          className={cn(
            'rounded-full px-4 py-1.5 text-sm font-medium transition',
            tab === 'history'
              ? 'bg-slate-200 text-slate-900 dark:bg-slate-700 dark:text-slate-100'
              : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800',
          )}
        >
          历史任务
        </button>
      </div>

      {hint ? <p className="text-sm text-slate-600 dark:text-slate-300">{hint}</p> : null}

      {tab === 'list' ? (
        <>
          {workflows.length === 0 ? (
            <p className="text-sm text-amber-700 dark:text-amber-300">
              请先在「工作流」中创建至少一个工作流，再添加定时任务。
            </p>
          ) : null}
          {sortedTasks.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 p-12 text-center text-slate-500 dark:border-slate-800">
              暂无定时任务，点击右上角「添加」创建。
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-1 lg:grid-cols-2">
              {sortedTasks.map((task) => {
                const wf = wfById.get(task.workflowId)
                const desc = wf
                  ? `${wf.name} · ${inputsPreview(task.startInputs as Record<string, unknown>)}`
                  : task.workflowNameSnapshot || task.workflowId
                return (
                  <div
                    key={task.id}
                    className="flex flex-col rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900/80"
                  >
                    <div className="flex gap-3 p-4">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-950/60 dark:text-red-400">
                        <AlarmClock className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="font-semibold text-slate-900 dark:text-slate-100">{task.name}</h3>
                          <Switch
                            checked={task.enabled}
                            onChange={(e) => void setTaskEnabled(task, e.target.checked)}
                            disabled={task.running}
                          />
                        </div>
                        <p className="mt-1 line-clamp-2 text-sm text-slate-600 dark:text-slate-400">{desc}</p>
                      </div>
                    </div>
                    <div className="border-t border-slate-100 px-4 py-3 dark:border-slate-800">
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-600 dark:text-slate-400">
                        <span className="inline-flex items-center gap-1">
                          <span className="text-red-500">●</span>
                          {task.workflowNameSnapshot || wf?.name || '工作流'}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Clock3 className="h-3.5 w-3.5" />
                          {scheduleSummaryZh(task.schedule)}
                        </span>
                        {task.lastRunAt != null ? (
                          <span>
                            上次执行 {formatLastRun(task.lastRunAt)}
                            <span
                              className={cn(
                                'ml-2 rounded-full px-2 py-0.5 text-[11px] font-medium',
                                task.lastRunStatus === 'ok'
                                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200'
                                  : 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
                              )}
                            >
                              {task.lastRunStatus === 'ok' ? '成功' : '失败'}
                            </span>
                          </span>
                        ) : (
                          <span>尚未执行</span>
                        )}
                        <div className="relative ml-auto">
                          <button
                            type="button"
                            className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                            aria-label="更多"
                            onClick={() => setMenuOpenId((id) => (id === task.id ? null : task.id))}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </button>
                          {menuOpenId === task.id ? (
                            <div className="absolute right-0 z-[60] mt-1 w-36 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-950">
                              <button
                                type="button"
                                className="block w-full px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-900"
                                onClick={() => openEdit(task)}
                              >
                                编辑
                              </button>
                              <button
                                type="button"
                                className="block w-full px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-900"
                                disabled={busyId === task.id || task.running}
                                onClick={() => void doRunNow(task)}
                              >
                                {busyId === task.id ? '执行中…' : '立即执行'}
                              </button>
                              <button
                                type="button"
                                className="block w-full px-3 py-2 text-left text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
                                onClick={() => void deleteTask(task)}
                              >
                                删除
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          <p className="text-xs text-slate-500 dark:text-slate-400">
            定时任务仅在应用运行期间触发；错过触发窗口（约 90 秒）的排期将跳过直至下次。
          </p>
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <label className="min-w-[200px] flex-1">
              <Select
                value={historyTaskId}
                onChange={(e) => setHistoryTaskId(e.target.value)}
                options={taskOptions}
              />
            </label>
            <label className="min-w-[200px] flex-1">
              <Select
                value={historyDate}
                onChange={(e) => setHistoryDate(e.target.value)}
                options={dateOptions}
              />
            </label>
          </div>
          {filteredRuns.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 p-12 text-center text-slate-500 dark:border-slate-800">
              暂无运行记录
            </div>
          ) : (
            <div className="relative pl-6">
              <div className="absolute bottom-0 left-[11px] top-2 w-px border-l border-dashed border-slate-300 dark:border-slate-600" />
              <div className="space-y-10">
                {runsByDate.map(([ymd, runs]) => (
                  <div key={ymd} className="relative">
                    <div className="mb-3 flex items-center gap-3">
                      <span className="absolute left-0 top-1.5 z-10 h-2 w-2 rounded-full bg-slate-400 ring-4 ring-white dark:bg-slate-500 dark:ring-slate-900" />
                      <span className="pl-6 text-sm font-medium text-slate-800 dark:text-slate-200">
                        {formatYmdSlash(ymd)}
                      </span>
                    </div>
                    <div className="space-y-3 pl-6">
                      {runs.map((r) => (
                        <div
                          key={r.id}
                          className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/80"
                        >
                          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
                            <span className="font-semibold text-slate-900 dark:text-slate-100">
                              {r.taskNameSnapshot}
                            </span>
                            <span
                              className={cn(
                                'rounded-full px-2 py-0.5 text-xs font-medium',
                                r.status === 'ok'
                                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200'
                                  : 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
                              )}
                            >
                              {r.status === 'ok' ? '成功' : '失败'}
                            </span>
                            <span className="ml-auto text-xs text-slate-500 dark:text-slate-400">
                              Tental ·{' '}
                              {new Date(r.startedAt).toLocaleString(undefined, {
                                month: '2-digit',
                                day: '2-digit',
                                hour: '2-digit',
                                minute: '2-digit',
                                second: '2-digit',
                              })}
                            </span>
                          </div>
                          <div className="prose prose-sm dark:prose-invert mt-3 max-w-none text-slate-800 dark:text-slate-200">
                            {r.outputText.trim() ? (
                              <ChatMarkdown text={r.outputText} />
                            ) : r.error ? (
                              <p className="text-sm text-red-600">{r.error}</p>
                            ) : (
                              <p className="text-sm text-slate-500">无输出</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {modal ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          onClick={(e) => e.target === e.currentTarget && setModal(null)}
        >
          <div className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-xl border border-slate-200 bg-white p-4 shadow-xl dark:border-slate-800 dark:bg-slate-950">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">
                {modal.kind === 'create' ? '添加任务' : `编辑 · ${modal.task.name}`}
              </h2>
              <Button type="button" variant="outline" size="sm" onClick={() => setModal(null)}>
                关闭
              </Button>
            </div>
            <div className="mt-4 space-y-4 text-sm">
              <label className="block">
                <span className="text-slate-600 dark:text-slate-400">任务名称</span>
                <input
                  className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-900"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="例如：每日天气推送"
                />
              </label>
              <label className="block">
                <span className="text-slate-600 dark:text-slate-400">选择工作流</span>
                <Select
                  className="mt-1"
                  value={formWorkflowId}
                  onChange={(e) => onWorkflowPick(e.target.value)}
                  options={workflows.map((w) => ({ value: w.id, label: w.name }))}
                />
              </label>
              {formWf ? (
                <div className="space-y-2 rounded-lg border border-slate-100 p-3 dark:border-slate-800">
                  <div className="text-xs font-medium text-slate-500">工作流参数</div>
                  {startParamsOf(formWf).length === 0 ? (
                    <p className="text-xs text-slate-500">该工作流开始节点未定义参数。</p>
                  ) : (
                    startParamsOf(formWf).map((p) => (
                      <label key={p.name} className="block">
                        <span className="text-slate-600 dark:text-slate-400">
                          {p.name}
                          {p.required ? <span className="text-red-500">*</span> : null}
                        </span>
                        <input
                          className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-900"
                          value={formStartInputs[p.name] ?? ''}
                          onChange={(e) =>
                            setFormStartInputs((prev) => ({ ...prev, [p.name]: e.target.value }))
                          }
                        />
                      </label>
                    ))
                  )}
                </div>
              ) : null}
              <div className="space-y-2">
                <span className="text-slate-600 dark:text-slate-400">执行频率</span>
                <Select
                  value={formScheduleKind}
                  onChange={(e) => setFormScheduleKind(e.target.value as 'daily' | 'weekly')}
                  options={[
                    { value: 'daily', label: '每天' },
                    { value: 'weekly', label: '每周（指定星期）' },
                  ]}
                />
                <label className="mt-2 flex items-center gap-2">
                  <CalendarDays className="h-4 w-4 text-slate-500" />
                  <span className="text-slate-600 dark:text-slate-400">时间</span>
                  <input
                    type="time"
                    className="rounded-md border border-slate-200 px-2 py-1 dark:border-slate-700 dark:bg-slate-900"
                    value={formTimeValue}
                    onChange={(e) => setFormTimeValue(e.target.value)}
                  />
                </label>
                {formScheduleKind === 'weekly' ? (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {WEEKDAY_LABELS.map((label, d) => (
                      <label key={d} className="inline-flex items-center gap-1 text-xs">
                        <input
                          type="checkbox"
                          checked={formWeekdays.has(d)}
                          onChange={(e) => {
                            setFormWeekdays((prev) => {
                              const next = new Set(prev)
                              if (e.target.checked) next.add(d)
                              else next.delete(d)
                              return next
                            })
                          }}
                        />
                        周{label}
                      </label>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="flex gap-2 pt-2">
                <Button type="button" onClick={() => void submitModal()}>
                  保存
                </Button>
                <Button type="button" variant="outline" onClick={() => setModal(null)}>
                  取消
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {menuOpenId ? (
        <button
          type="button"
          className="fixed inset-0 z-[55] cursor-default bg-transparent"
          aria-label="关闭菜单"
          onClick={() => setMenuOpenId(null)}
        />
      ) : null}
    </div>
  )
}
