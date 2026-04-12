import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  History,
  Loader2,
  Pencil,
  Play,
  Plus,
  Trash2,
  Workflow as WorkflowIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  emptyWorkflow,
  executeWorkflow,
  loadWorkflowStore,
  saveWorkflowStore,
  type WorkflowDefinition,
  type WorkflowRun,
  type WorkflowStoreData,
} from '@/lib/workflow-api'
import { startParamsOf } from '@/lib/workflow-graph'

export function WorkflowListPage() {
  const navigate = useNavigate()
  const [store, setStore] = useState<WorkflowStoreData | null>(null)
  const [hint, setHint] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [modal, setModal] = useState<
    | { kind: 'run'; wf: WorkflowDefinition }
    | { kind: 'history'; wf: WorkflowDefinition }
    | null
  >(null)
  const [runInputs, setRunInputs] = useState<Record<string, string>>({})
  const [lastRun, setLastRun] = useState<WorkflowRun | null>(null)

  const reload = useCallback(async () => {
    const s = await loadWorkflowStore()
    setStore(s)
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const persist = useCallback(async (next: WorkflowStoreData) => {
    setStore(next)
    await saveWorkflowStore(next)
  }, [])

  const create = useCallback(async () => {
    const name = window.prompt('工作流名称', '新工作流')
    if (name === null) return
    const base = store ?? { workflows: [], runs: [] }
    const w = emptyWorkflow(name.trim() || '新工作流')
    await persist({ ...base, workflows: [w, ...base.workflows] })
    setHint('已创建')
    navigate(`/workflow/${w.id}/edit`)
  }, [store, persist, navigate])

  const remove = useCallback(
    async (wf: WorkflowDefinition) => {
      if (!store || !window.confirm(`删除工作流「${wf.name}」？`)) return
      await persist({
        ...store,
        workflows: store.workflows.filter((w) => w.id !== wf.id),
      })
      setHint('已删除')
    },
    [store, persist],
  )

  const runsFor = useCallback(
    (id: string) => (store?.runs ?? []).filter((r) => r.workflowId === id).sort((a, b) => b.startedAt - a.startedAt),
    [store],
  )

  const openRun = (wf: WorkflowDefinition) => {
    const params = startParamsOf(wf)
    const o: Record<string, string> = {}
    for (const p of params) o[p.name] = ''
    setRunInputs(o)
    setLastRun(null)
    setModal({ kind: 'run', wf })
  }

  const doRun = async () => {
    if (!modal || modal.kind !== 'run') return
    const wf = modal.wf
    const params = startParamsOf(wf)
    const obj: Record<string, unknown> = {}
    for (const p of params) {
      const v = runInputs[p.name]?.trim() ?? ''
      if (!v && p.required) {
        setHint(`请填写：${p.name}`)
        return
      }
      obj[p.name] = v
    }
    setBusyId(wf.id)
    setHint(null)
    try {
      const run = await executeWorkflow(wf.id, obj)
      setLastRun(run)
      await reload()
      setHint(run.status === 'ok' ? '执行完成' : run.error ?? '失败')
    } catch (e) {
      setHint(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyId(null)
    }
  }

  const sorted = useMemo(
    () => [...(store?.workflows ?? [])].sort((a, b) => b.updatedAt - a.updatedAt),
    [store],
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <WorkflowIcon className="h-6 w-6 text-slate-600" />
          <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">工作流</h1>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => void create()}>
          <Plus className="mr-1 h-4 w-4" />
          新建工作流
        </Button>
      </div>
      {hint ? <p className="text-sm text-slate-600 dark:text-slate-300">{hint}</p> : null}

      {sorted.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 p-12 text-center text-slate-500 dark:border-slate-800">
          暂无工作流，点击「新建工作流」开始。
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map((wf) => {
            const runs = runsFor(wf.id)
            return (
              <div
                key={wf.id}
                className="flex flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/80"
              >
                <div className="font-medium text-slate-900 dark:text-slate-100">{wf.name}</div>
                <div className="mt-1 text-xs text-slate-500">
                  更新 {new Date(wf.updatedAt).toLocaleString()} · {runs.length} 次运行
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="outline" asChild>
                    <Link to={`/workflow/${wf.id}/edit`}>
                      <Pencil className="mr-1 h-3.5 w-3.5" />
                      编辑
                    </Link>
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => openRun(wf)}>
                    <Play className="mr-1 h-3.5 w-3.5" />
                    运行
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => setModal({ kind: 'history', wf })}>
                    <History className="mr-1 h-3.5 w-3.5" />
                    历史
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="border-red-200 text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-300"
                    onClick={() => void remove(wf)}
                  >
                    <Trash2 className="mr-1 h-3.5 w-3.5" />
                    删除
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {modal?.kind === 'run' ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          onClick={(e) => e.target === e.currentTarget && setModal(null)}
        >
          <div className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-xl border border-slate-200 bg-white p-4 shadow-xl dark:border-slate-800 dark:bg-slate-950">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">运行 · {modal.wf.name}</h2>
              <Button type="button" variant="outline" size="sm" onClick={() => setModal(null)}>
                关闭
              </Button>
            </div>
            <div className="mt-4 space-y-3">
              {startParamsOf(modal.wf).map((p) => (
                <label key={p.name} className="block text-sm">
                  <span className="text-slate-600 dark:text-slate-400">
                    {p.name}
                    {p.required ? <span className="text-red-500">*</span> : null}
                  </span>
                  <input
                    className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 dark:border-slate-700 dark:bg-slate-900"
                    value={runInputs[p.name] ?? ''}
                    onChange={(e) => setRunInputs((prev) => ({ ...prev, [p.name]: e.target.value }))}
                  />
                </label>
              ))}
              <Button type="button" disabled={busyId === modal.wf.id} onClick={() => void doRun()}>
                {busyId === modal.wf.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Play className="mr-1 h-4 w-4" />
                    执行
                  </>
                )}
              </Button>
              {lastRun ? (
                <pre className="max-h-48 overflow-auto rounded border border-slate-100 bg-slate-50 p-2 text-xs dark:border-slate-800 dark:bg-slate-900">
                  {JSON.stringify(lastRun.outputs, null, 2)}
                </pre>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {modal?.kind === 'history' ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          onClick={(e) => e.target === e.currentTarget && setModal(null)}
        >
          <div className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-xl border border-slate-200 bg-white p-4 shadow-xl dark:border-slate-800 dark:bg-slate-950">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">运行历史 · {modal.wf.name}</h2>
              <Button type="button" variant="outline" size="sm" onClick={() => setModal(null)}>
                关闭
              </Button>
            </div>
            <ul className="mt-4 space-y-2 text-xs">
              {runsFor(modal.wf.id).length === 0 ? (
                <li className="text-slate-500">暂无记录</li>
              ) : (
                runsFor(modal.wf.id).map((r) => (
                  <li key={r.id} className="rounded border border-slate-100 p-2 dark:border-slate-800">
                    <div className="flex flex-wrap gap-2 text-slate-600">
                      <span>{new Date(r.startedAt).toLocaleString()}</span>
                      <span className={r.status === 'ok' ? 'text-emerald-600' : 'text-red-600'}>{r.status}</span>
                    </div>
                    <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap text-[11px]">
                      {JSON.stringify(r.outputs, null, 2)}
                    </pre>
                    {r.error ? <div className="text-red-600">{r.error}</div> : null}
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
      ) : null}
    </div>
  )
}
