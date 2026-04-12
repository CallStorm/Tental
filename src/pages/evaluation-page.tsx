import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Play, Square, Sparkles, Trash2, Plus, ClipboardCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import {
  compactTraceForJudge,
  deleteRunById,
  emptyCase,
  emptySuite,
  generateOneEvaluationCase,
  judgeEvaluationItem,
  loadEvaluationStore,
  loadEvaluationModelContext,
  patchSuite,
  runEvaluationStream,
  saveEvaluationStore,
  sortCases,
  summarizeRunItems,
  upsertRun,
  type EvaluationCase,
  type EvaluationRun,
  type EvaluationRunItem,
  type EvaluationStoreData,
} from '@/lib/evaluation-api'

function newRunId(): string {
  return crypto.randomUUID()
}

function nowMs(): number {
  return Date.now()
}

export function EvaluationPage() {
  const [store, setStore] = useState<EvaluationStoreData | null>(null)
  const [activeSuiteId, setActiveSuiteId] = useState<string | null>(null)
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null)
  const [hint, setHint] = useState<string | null>(null)
  const [aiTheme, setAiTheme] = useState('')
  const [genBusy, setGenBusy] = useState(false)
  const [running, setRunning] = useState(false)
  const [debugEnabled, setDebugEnabled] = useState(true)
  const [passThreshold, setPassThreshold] = useState(70)
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null)
  const [liveRun, setLiveRun] = useState<EvaluationRun | null>(null)
  const [historyOpenId, setHistoryOpenId] = useState<string | null>(null)
  const cancelRef = useRef(false)

  const reload = useCallback(async () => {
    setHint(null)
    const s = await loadEvaluationStore()
    setStore(s)
    return s
  }, [])

  useEffect(() => {
    void (async () => {
      const s = await loadEvaluationStore()
      setStore(s)
      if (s.suites.length && !activeSuiteId) {
        setActiveSuiteId(s.suites[0]?.id ?? null)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial load only
  }, [])

  useEffect(() => {
    if (!store) return
    if (activeSuiteId && !store.suites.some((s) => s.id === activeSuiteId)) {
      setActiveSuiteId(store.suites[0]?.id ?? null)
      setSelectedCaseId(null)
    }
  }, [store, activeSuiteId])

  const activeSuite = useMemo(() => {
    if (!store || !activeSuiteId) return null
    return store.suites.find((x) => x.id === activeSuiteId) ?? null
  }, [store, activeSuiteId])

  const sortedCases = useMemo(() => {
    if (!activeSuite) return []
    return sortCases(activeSuite.cases)
  }, [activeSuite])

  const selectedCase = useMemo(() => {
    if (!selectedCaseId) return null
    return sortedCases.find((c) => c.id === selectedCaseId) ?? null
  }, [sortedCases, selectedCaseId])

  const persistFull = useCallback(async (next: EvaluationStoreData) => {
    setStore(next)
    await saveEvaluationStore(next)
  }, [])

  const persistSuiteCases = useCallback(
    async (suiteId: string, cases: EvaluationCase[]) => {
      if (!store) return
      const next = patchSuite(store, suiteId, { cases })
      await persistFull(next)
    },
    [store, persistFull],
  )

  const createSuite = useCallback(async () => {
    const name = window.prompt('测评集名称', '新测评集')
    if (name === null) return
    const trimmed = name.trim() || '新测评集'
    const base = store ?? { suites: [], runs: [] }
    const s = emptySuite(trimmed)
    const next: EvaluationStoreData = { ...base, suites: [s, ...base.suites] }
    await persistFull(next)
    setActiveSuiteId(s.id)
    setSelectedCaseId(null)
    setHint('已创建测评集')
  }, [store, persistFull])

  const deleteSuite = useCallback(async () => {
    if (!store || !activeSuiteId || !activeSuite) return
    if (!window.confirm(`确定删除测评集「${activeSuite.name}」及其全部题目？`)) return
    const next: EvaluationStoreData = {
      ...store,
      suites: store.suites.filter((s) => s.id !== activeSuiteId),
    }
    await persistFull(next)
    setActiveSuiteId(next.suites[0]?.id ?? null)
    setSelectedCaseId(null)
    setHint('已删除')
  }, [store, activeSuiteId, activeSuite, persistFull])

  const renameSuite = useCallback(async () => {
    if (!activeSuite) return
    const name = window.prompt('重命名', activeSuite.name)
    if (name === null) return
    const trimmed = name.trim()
    if (!trimmed) return
    if (!store) return
    const next = patchSuite(store, activeSuite.id, { name: trimmed })
    await persistFull(next)
  }, [store, activeSuite, persistFull])

  const addEmptyCase = useCallback(async () => {
    if (!activeSuiteId || !activeSuite) return
    const nc = emptyCase(activeSuite.cases)
    const cases = [...activeSuite.cases, nc]
    await persistSuiteCases(activeSuiteId, cases)
    setSelectedCaseId(nc.id)
    setHint('已新增题目（请填写后保存）')
  }, [activeSuiteId, activeSuite, persistSuiteCases])

  const updateCaseLocal = useCallback(
    (caseId: string, patch: Partial<EvaluationCase>) => {
      if (!store || !activeSuiteId || !activeSuite) return
      const cases = activeSuite.cases.map((c) => (c.id === caseId ? { ...c, ...patch } : c))
      const next = patchSuite(store, activeSuiteId, { cases })
      setStore(next)
    },
    [store, activeSuiteId, activeSuite],
  )

  const saveCase = useCallback(
    async (c: EvaluationCase) => {
      if (!activeSuiteId || !activeSuite) return
      if (!c.prompt.trim() || !c.expected.trim()) {
        setHint('问题与预期不能为空')
        return
      }
      const cases = activeSuite.cases.map((x) => (x.id === c.id ? { ...c } : x))
      await persistSuiteCases(activeSuiteId, cases)
      setHint('已保存题目')
    },
    [activeSuiteId, activeSuite, persistSuiteCases],
  )

  const deleteCase = useCallback(
    async (caseId: string) => {
      if (!activeSuiteId || !activeSuite) return
      if (!window.confirm('删除该题目？')) return
      const cases = activeSuite.cases.filter((c) => c.id !== caseId)
      await persistSuiteCases(activeSuiteId, cases)
      if (selectedCaseId === caseId) setSelectedCaseId(null)
      setHint('已删除题目')
    },
    [activeSuiteId, activeSuite, persistSuiteCases, selectedCaseId],
  )

  const moveCase = useCallback(
    async (caseId: string, dir: -1 | 1) => {
      if (!activeSuiteId || !activeSuite) return
      const list = sortCases(activeSuite.cases)
      const idx = list.findIndex((c) => c.id === caseId)
      if (idx < 0) return
      const j = idx + dir
      if (j < 0 || j >= list.length) return
      const a = list[idx]!
      const b = list[j]!
      const orderA = a.order
      const orderB = b.order
      const cases = activeSuite.cases.map((c) => {
        if (c.id === a.id) return { ...c, order: orderB }
        if (c.id === b.id) return { ...c, order: orderA }
        return c
      })
      await persistSuiteCases(activeSuiteId, cases)
    },
    [activeSuiteId, activeSuite, persistSuiteCases],
  )

  const generateOne = useCallback(async () => {
    setHint(null)
    const ctx = await loadEvaluationModelContext()
    if (!ctx.defaultProviderId) {
      setHint('请先在设置中配置默认模型供应商')
      return
    }
    setGenBusy(true)
    try {
      const one = await generateOneEvaluationCase({
        providerId: ctx.defaultProviderId,
        userHint: aiTheme,
      })
      if (!one) {
        setHint('生成失败：无法解析模型返回，请重试')
        return
      }
      if (!activeSuiteId || !activeSuite) {
        setHint('请先创建并选择测评集')
        return
      }
      const nc = emptyCase(activeSuite.cases)
      nc.prompt = one.prompt
      nc.expected = one.expected
      const cases = [...activeSuite.cases, nc]
      await persistSuiteCases(activeSuiteId, cases)
      setSelectedCaseId(nc.id)
      setHint('已生成一条题目（可修改后再保存确认）')
    } catch (e) {
      setHint(e instanceof Error ? e.message : String(e))
    } finally {
      setGenBusy(false)
    }
  }, [aiTheme, activeSuiteId, activeSuite, persistSuiteCases])

  const stopBatch = useCallback(() => {
    cancelRef.current = true
    setHint('已请求停止（当前题目结束后停止）')
  }, [])

  const startBatch = useCallback(async () => {
    setHint(null)
    if (!store || !activeSuite) return
    const ctx = await loadEvaluationModelContext()
    if (!ctx.defaultProviderId) {
      setHint('请先在设置中配置默认模型供应商')
      return
    }
    const toRun = sortedCases.filter((c) => c.enabled && c.prompt.trim() && c.expected.trim())
    if (!toRun.length) {
      setHint('没有可测题目：请启用至少一道已填写问题与预期的题')
      return
    }
    cancelRef.current = false
    setRunning(true)
    setProgress({ current: 0, total: toRun.length })
    const runId = newRunId()
    const startedAt = nowMs()
    const items: EvaluationRunItem[] = []

    const shell: EvaluationRun = {
      id: runId,
      suiteId: activeSuite.id,
      suiteNameSnapshot: activeSuite.name,
      startedAt,
      finishedAt: startedAt,
      items: [],
      summary: { total: 0, passed: 0, failed: 0, avgScore: 0 },
    }
    setLiveRun(shell)

    try {
      for (let i = 0; i < toRun.length; i++) {
        if (cancelRef.current) break
        const c = toRun[i]!
        setProgress({ current: i + 1, total: toRun.length })

        let finalAnswer = ''
        let thinking: string | undefined
        let debugLogs: string[] = []
        let toolTraces: string[] = []
        let errMsg: string | undefined

        try {
          const streamed = await runEvaluationStream({
            providerId: ctx.defaultProviderId,
            userPrompt: c.prompt,
            debug: debugEnabled,
          })
          finalAnswer = streamed.content
          thinking = streamed.thinking || undefined
          debugLogs = streamed.debugLogs
          toolTraces = streamed.toolTraces
        } catch (e) {
          errMsg = e instanceof Error ? e.message : String(e)
        }

        let judge: { score: number; pass: boolean; reason: string; diffHighlights: string[] } = {
          score: 0,
          pass: false,
          reason: '',
          diffHighlights: [],
        }
        let judgeErr: string | undefined
        if (!errMsg) {
          const traceSummary = compactTraceForJudge(debugLogs, toolTraces)
          try {
            judge = await judgeEvaluationItem({
              providerId: ctx.defaultProviderId,
              prompt: c.prompt,
              expected: c.expected,
              finalAnswer,
              traceSummary,
              passThreshold,
            })
          } catch (e) {
            judgeErr = e instanceof Error ? e.message : String(e)
            judge = {
              score: 0,
              pass: false,
              reason: '评判失败',
              diffHighlights: [judgeErr],
            }
          }
        } else {
          judge = {
            score: 0,
            pass: false,
            reason: '执行失败',
            diffHighlights: [errMsg],
          }
        }

        const item: EvaluationRunItem = {
          caseId: c.id,
          prompt: c.prompt,
          expected: c.expected,
          finalAnswer,
          thinking,
          debugLogs,
          toolTraces,
          score: judge.score,
          pass: !errMsg && !judgeErr && judge.pass,
          reason: errMsg
            ? `执行错误：${errMsg}`
            : judgeErr
              ? `评判错误：${judgeErr}`
              : judge.reason,
          diffHighlights: judge.diffHighlights,
          error: errMsg ?? judgeErr,
        }
        items.push(item)
        const summary = summarizeRunItems(items)
        const partial: EvaluationRun = {
          ...shell,
          items: [...items],
          summary,
          finishedAt: nowMs(),
        }
        setLiveRun(partial)
      }

      const finishedAt = nowMs()
      const summary = summarizeRunItems(items)
      const finalRun: EvaluationRun = {
        id: runId,
        suiteId: activeSuite.id,
        suiteNameSnapshot: activeSuite.name,
        startedAt,
        finishedAt,
        items,
        summary,
      }
      setLiveRun(finalRun)
      const latest = await reload()
      const merged = upsertRun(latest, finalRun)
      await persistFull(merged)
      setHint(cancelRef.current ? '已停止，部分结果已保存' : '测评完成并已写入记录')
    } finally {
      setRunning(false)
      setProgress(null)
    }
  }, [store, activeSuite, sortedCases, debugEnabled, passThreshold, reload, persistFull])

  const deleteHistoryRun = useCallback(
    async (runId: string) => {
      if (!store) return
      if (!window.confirm('删除该次测评记录？')) return
      const next = deleteRunById(store, runId)
      await persistFull(next)
      if (historyOpenId === runId) setHistoryOpenId(null)
      setHint('已删除记录')
    },
    [store, persistFull, historyOpenId],
  )

  const runsSorted = useMemo(() => {
    if (!store) return []
    return [...store.runs].sort((a, b) => b.startedAt - a.startedAt)
  }, [store])

  if (!store) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-slate-500">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    )
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
      <header className="flex shrink-0 flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-semibold text-slate-900 dark:text-slate-50">
            <ClipboardCheck className="h-7 w-7" />
            测评
          </h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            题库与历史保存在用户目录下的 evaluation-store.json
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void reload()}>
            刷新
          </Button>
          <Button type="button" size="sm" onClick={() => void createSuite()}>
            <Plus className="mr-1 h-4 w-4" />
            新建测评集
          </Button>
        </div>
      </header>

      {hint ? (
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-300">
          {hint}
        </p>
      ) : null}

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[280px_1fr]">
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto rounded-xl border border-slate-200 p-3 dark:border-slate-800">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">测评集</div>
          <select
            className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            value={activeSuiteId ?? ''}
            onChange={(e) => {
              setActiveSuiteId(e.target.value || null)
              setSelectedCaseId(null)
            }}
          >
            {store.suites.length === 0 ? <option value="">（无，请先新建）</option> : null}
            {store.suites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!activeSuite}
              onClick={() => void renameSuite()}
            >
              重命名
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!activeSuite}
              className="text-rose-600 dark:text-rose-400"
              onClick={() => void deleteSuite()}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>

          <div className="mt-2 text-xs font-medium text-slate-500 dark:text-slate-400">题目</div>
          <Button type="button" size="sm" disabled={!activeSuite} onClick={() => void addEmptyCase()}>
            <Plus className="mr-1 h-4 w-4" />
            新增空题目
          </Button>
          <div className="space-y-1">
            {sortedCases.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelectedCaseId(c.id)}
                className={cn(
                  'flex w-full flex-col rounded-lg border px-2 py-1.5 text-left text-sm transition',
                  selectedCaseId === c.id
                    ? 'border-slate-900 bg-slate-100 dark:border-slate-100 dark:bg-slate-800'
                    : 'border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/80',
                )}
              >
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={c.enabled}
                    onChange={(e) => {
                      e.stopPropagation()
                      const sid = activeSuiteId
                      const su = activeSuite
                      if (!sid || !su) return
                      void persistSuiteCases(
                        sid,
                        su.cases.map((x) => (x.id === c.id ? { ...x, enabled: e.target.checked } : x)),
                      )
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="rounded border-slate-300"
                  />
                  <span className="line-clamp-2 font-medium">
                    {c.prompt.trim() ? c.prompt.slice(0, 80) : '（未填写）'}
                  </span>
                </div>
              </button>
            ))}
            {activeSuite && sortedCases.length === 0 ? (
              <p className="text-xs text-slate-500">暂无题目</p>
            ) : null}
          </div>
        </div>

        <div className="flex min-h-0 min-w-0 flex-col gap-4 overflow-y-auto">
          <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-50">AI 单次生成一条</h3>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
              描述主题或场景；生成后可编辑再保存到列表。
            </p>
            <textarea
              value={aiTheme}
              onChange={(e) => setAiTheme(e.target.value)}
              placeholder="例如：测试能否正确解释 HTTP 与 HTTPS 区别"
              className="mt-2 min-h-[72px] w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
            <Button
              type="button"
              className="mt-2"
              size="sm"
              disabled={genBusy || !activeSuite}
              onClick={() => void generateOne()}
            >
              {genBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
              生成一条
            </Button>
          </div>

          {selectedCase ? (
            <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">编辑题目</h3>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => void moveCase(selectedCase.id, -1)}>
                    上移
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => void moveCase(selectedCase.id, 1)}>
                    下移
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => void deleteCase(selectedCase.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">问题</label>
              <textarea
                value={selectedCase.prompt}
                onChange={(e) => updateCaseLocal(selectedCase.id, { prompt: e.target.value })}
                className="mt-1 min-h-[100px] w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
              <label className="mt-3 block text-xs font-medium text-slate-600 dark:text-slate-400">预期输出</label>
              <textarea
                value={selectedCase.expected}
                onChange={(e) => updateCaseLocal(selectedCase.id, { expected: e.target.value })}
                className="mt-1 min-h-[100px] w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
              <Button type="button" className="mt-3" size="sm" onClick={() => void saveCase(selectedCase)}>
                保存本题
              </Button>
            </div>
          ) : (
            <p className="text-sm text-slate-500">请从左侧选择一道题目，或新增题目。</p>
          )}

          <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
            <h3 className="text-sm font-semibold">执行测评</h3>
            <div className="mt-3 flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-sm">
                <span className="text-slate-600 dark:text-slate-400">通过分数线</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={passThreshold}
                  onChange={(e) => setPassThreshold(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
                  className="h-9 w-20 rounded-md border border-slate-200 px-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-600 dark:text-slate-400">Debug 追踪</span>
                <Switch checked={debugEnabled} onChange={(e) => setDebugEnabled(e.target.checked)} />
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" disabled={running || !activeSuite} onClick={() => void startBatch()}>
                {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                开始测试
              </Button>
              <Button type="button" variant="outline" disabled={!running} onClick={stopBatch}>
                <Square className="mr-2 h-4 w-4" />
                停止
              </Button>
            </div>
            {progress ? (
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                进度 {progress.current}/{progress.total}
              </p>
            ) : null}
          </div>

          {liveRun && liveRun.items.length > 0 ? (
            <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
              <h3 className="text-sm font-semibold">本轮结果</h3>
              <p className="mt-1 text-xs text-slate-600">
                通过 {liveRun.summary.passed}/{liveRun.summary.total} · 均分 {liveRun.summary.avgScore}
              </p>
              <ul className="mt-3 space-y-2 text-sm">
                {liveRun.items.map((it, idx) => (
                  <li key={`${it.caseId}-${idx}`} className="rounded-lg border border-slate-100 p-2 dark:border-slate-800">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 text-xs font-medium',
                          it.pass ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200' : 'bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-200',
                        )}
                      >
                        {it.pass ? '通过' : '未通过'} {it.score}
                      </span>
                      <span className="line-clamp-1 text-slate-700 dark:text-slate-300">{it.prompt.slice(0, 120)}</span>
                    </div>
                    <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">{it.reason}</p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
            <h3 className="text-sm font-semibold">历史记录</h3>
            {runsSorted.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">暂无</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {runsSorted.map((r) => (
                  <li key={r.id} className="rounded-lg border border-slate-100 dark:border-slate-800">
                    <div className="flex flex-wrap items-center justify-between gap-2 p-2">
                      <button
                        type="button"
                        className="text-left text-sm font-medium text-slate-800 dark:text-slate-200"
                        onClick={() => setHistoryOpenId((x) => (x === r.id ? null : r.id))}
                      >
                        {new Date(r.startedAt).toLocaleString()} · {r.suiteNameSnapshot || r.suiteId} ·{' '}
                        {r.summary.passed}/{r.summary.total} 通过
                      </button>
                      <Button type="button" variant="outline" size="sm" onClick={() => void deleteHistoryRun(r.id)}>
                        删除
                      </Button>
                    </div>
                    {historyOpenId === r.id ? (
                      <div className="border-t border-slate-100 px-2 py-2 text-xs dark:border-slate-800">
                        {r.items.map((it, idx) => (
                          <details key={`${r.id}-${idx}`} className="mb-2 rounded bg-slate-50 p-2 dark:bg-slate-950/50">
                            <summary className="cursor-pointer font-medium">
                              {it.pass ? '✓' : '✗'} {it.score} — {it.prompt.slice(0, 80)}
                            </summary>
                            <div className="mt-2 space-y-1 text-slate-600 dark:text-slate-400">
                              <div>
                                <span className="font-semibold text-slate-800 dark:text-slate-200">预期</span>
                                <pre className="mt-0.5 whitespace-pre-wrap">{it.expected}</pre>
                              </div>
                              <div>
                                <span className="font-semibold text-slate-800 dark:text-slate-200">回答</span>
                                <pre className="mt-0.5 whitespace-pre-wrap">{it.finalAnswer || '（空）'}</pre>
                              </div>
                              <div>
                                <span className="font-semibold text-slate-800 dark:text-slate-200">说明</span>
                                <p className="mt-0.5">{it.reason}</p>
                              </div>
                              {it.diffHighlights.length ? (
                                <ul className="list-inside list-disc">
                                  {it.diffHighlights.map((d, i) => (
                                    <li key={i}>{d}</li>
                                  ))}
                                </ul>
                              ) : null}
                              {it.debugLogs.length ? (
                                <details className="mt-1">
                                  <summary>Debug 日志 ({it.debugLogs.length})</summary>
                                  <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap text-[10px]">
                                    {it.debugLogs.join('\n\n')}
                                  </pre>
                                </details>
                              ) : null}
                            </div>
                          </details>
                        ))}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
