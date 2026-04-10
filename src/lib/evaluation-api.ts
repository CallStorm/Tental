import { completeChat, streamChat, type ChatMessage, type ChatTurn, type StreamChatEvent } from '@/lib/chat-api'
import { loadModelConfig } from '@/lib/model-config'
import { buildApiTurns, normalizeChatSkinId, type ChatSkinId } from '@/lib/chat-ui-skins'
import { loadConfig } from '@/lib/tauri-config'
import { invoke } from '@tauri-apps/api/core'

export type EvaluationCase = {
  id: string
  enabled: boolean
  order: number
  prompt: string
  expected: string
  rubric?: string
}

export type EvaluationSuite = {
  id: string
  name: string
  description?: string
  createdAt: number
  updatedAt: number
  cases: EvaluationCase[]
}

export type EvaluationRunItem = {
  caseId: string
  prompt: string
  expected: string
  finalAnswer: string
  thinking?: string
  debugLogs: string[]
  toolTraces: string[]
  score: number
  pass: boolean
  reason: string
  diffHighlights: string[]
  error?: string
}

export type EvaluationRunSummary = {
  total: number
  passed: number
  failed: number
  avgScore: number
}

export type EvaluationRun = {
  id: string
  suiteId: string
  suiteNameSnapshot: string
  startedAt: number
  finishedAt: number
  items: EvaluationRunItem[]
  summary: EvaluationRunSummary
}

export type EvaluationStoreData = {
  suites: EvaluationSuite[]
  runs: EvaluationRun[]
}

const DEBUG_LOG_MAX = 220
const TOOL_TRACE_MAX = 80

function newId(): string {
  return crypto.randomUUID()
}

function nowMs(): number {
  return Date.now()
}

function isObject(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === 'object'
}

export async function loadEvaluationStore(): Promise<EvaluationStoreData> {
  const raw = await invoke<EvaluationStoreData>('load_evaluation_store')
  return {
    suites: Array.isArray(raw.suites) ? raw.suites : [],
    runs: Array.isArray(raw.runs) ? raw.runs : [],
  }
}

export async function saveEvaluationStore(store: EvaluationStoreData): Promise<void> {
  await invoke('save_evaluation_store', { store })
}

export function sortCases(cases: EvaluationCase[]): EvaluationCase[] {
  return [...cases].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
}

export function nextCaseOrder(cases: EvaluationCase[]): number {
  if (!cases.length) return 0
  return Math.max(...cases.map((c) => c.order), 0) + 1
}

export function emptySuite(name: string): EvaluationSuite {
  const t = nowMs()
  return {
    id: newId(),
    name,
    description: undefined,
    createdAt: t,
    updatedAt: t,
    cases: [],
  }
}

export function emptyCase(cases: EvaluationCase[]): EvaluationCase {
  return {
    id: newId(),
    enabled: true,
    order: nextCaseOrder(cases),
    prompt: '',
    expected: '',
    rubric: undefined,
  }
}

function trimLogs(lines: string[], max: number): string[] {
  return lines.length > max ? lines.slice(-max) : lines
}

/** One user turn through agent (tools + debug), same event shape as chat. */
export async function runEvaluationStream(options: {
  providerId: string | null
  userPrompt: string
  skinId: ChatSkinId
  personaEnabled: boolean
  debug: boolean
}): Promise<{ content: string; thinking: string; debugLogs: string[]; toolTraces: string[] }> {
  const userMsg: ChatMessage = {
    id: newId(),
    role: 'user',
    content: options.userPrompt,
    createdAt: nowMs(),
  }
  const turns: ChatTurn[] = buildApiTurns([userMsg], options.skinId, options.personaEnabled)

  let thinkingAcc = ''
  let contentAcc = ''
  const debugLogs: string[] = []
  const toolTraces: string[] = []

  const appendDebug = (line: string) => {
    debugLogs.push(line)
    if (debugLogs.length > DEBUG_LOG_MAX) debugLogs.splice(0, debugLogs.length - DEBUG_LOG_MAX)
  }
  const appendTool = (line: string) => {
    toolTraces.push(line)
    if (toolTraces.length > TOOL_TRACE_MAX) toolTraces.splice(0, toolTraces.length - TOOL_TRACE_MAX)
  }

  await streamChat({
    providerId: options.providerId,
    messages: turns,
    debug: options.debug,
    onEvent: (e: StreamChatEvent) => {
      if (e.event === 'debug_trace' && isObject(e.tool)) {
        const stage = typeof e.tool.stage === 'string' ? e.tool.stage : 'trace'
        const logs =
          'messages' in e.tool
            ? JSON.stringify((e.tool as Record<string, unknown>).messages, null, 2)
            : JSON.stringify((e.tool as Record<string, unknown>).message ?? e.tool, null, 2)
        appendDebug(`[${stage}] ${logs}`)
        return
      }
      if (e.event === 'delta') {
        if (e.thinkingDelta) thinkingAcc += e.thinkingDelta
        if (e.contentDelta) contentAcc += e.contentDelta
        return
      }
      if (e.event === 'tool_call' && isObject(e.tool)) {
        const name = typeof e.tool.name === 'string' ? e.tool.name : 'unknown'
        const input = (e.tool as Record<string, unknown>).input
        appendTool(`call ${name} ${JSON.stringify(input ?? null)}`)
        return
      }
      if (e.event === 'tool_result' && isObject(e.tool)) {
        const name = typeof e.tool.name === 'string' ? e.tool.name : 'unknown'
        const ok = !!(e.tool as Record<string, unknown>).ok
        appendTool(`result ${name} ok=${ok}`)
        return
      }
    },
  })

  return {
    content: contentAcc,
    thinking: thinkingAcc,
    debugLogs: trimLogs(debugLogs, DEBUG_LOG_MAX),
    toolTraces: trimLogs(toolTraces, TOOL_TRACE_MAX),
  }
}

export type JudgeResult = {
  score: number
  pass: boolean
  reason: string
  diffHighlights: string[]
}

export function parseJudgeJson(raw: string, passThreshold: number): JudgeResult {
  const trimmed = raw.trim()
  const tryParse = (s: string): JudgeResult | null => {
    try {
      const v = JSON.parse(s) as unknown
      if (!isObject(v)) return null
      const score = typeof v.score === 'number' ? Math.max(0, Math.min(100, Math.round(v.score))) : 0
      const reason = typeof v.reason === 'string' ? v.reason : ''
      const dh = v.diffHighlights
      const diffHighlights = Array.isArray(dh)
        ? dh.filter((x): x is string => typeof x === 'string')
        : []
      const pass = score >= passThreshold
      return { score, pass, reason: reason || '（无说明）', diffHighlights }
    } catch {
      return null
    }
  }

  const direct = tryParse(trimmed)
  if (direct) return direct

  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence?.[1]) {
    const nested = tryParse(fence[1].trim())
    if (nested) return nested
  }

  return {
    score: 0,
    pass: false,
    reason: '无法解析评判 JSON，请重试测评或检查模型输出',
    diffHighlights: [],
  }
}

export async function judgeEvaluationItem(options: {
  providerId: string | null
  prompt: string
  expected: string
  finalAnswer: string
  traceSummary: string
  passThreshold: number
}): Promise<JudgeResult> {
  const rubric = `
你只输出一个 JSON 对象，不要 markdown，不要其它文字。字段：
- score: 0-100 整数，对照「预期输出」评估「模型回答」的符合度与可用性
- pass: 布尔，若 score>=${options.passThreshold} 应为 true
- reason: 简短中文说明
- diffHighlights: 字符串数组，列出不一致或风险点（无则 []）
`.trim()

  const payload = `
${rubric}

【题目】
${options.prompt}

【预期输出】
${options.expected}

【模型最终回答】
${options.finalAnswer}

【执行过程摘要（API/tool 调试摘要，可能不全）】
${options.traceSummary || '（无）'}
`.trim()

  const text = await completeChat({
    providerId: options.providerId,
    messages: [{ role: 'user', content: payload }],
  })
  return parseJudgeJson(text, options.passThreshold)
}

export function buildGenerateOneCasePrompt(userHint: string): string {
  const h = userHint.trim() || '通用助手能力'
  return `
你只输出一个 JSON 对象，不要 markdown，不要其它文字。字段：
- prompt: 字符串，给用户/助手的一条具体测评问题（清晰、可验证）
- expected: 字符串，该问题下理想回答要点或期望结论（可多条要点）

测评主题/方向：${h}
`.trim()
}

export async function generateOneEvaluationCase(options: {
  providerId: string | null
  userHint: string
}): Promise<{ prompt: string; expected: string } | null> {
  const raw = await completeChat({
    providerId: options.providerId,
    messages: [{ role: 'user', content: buildGenerateOneCasePrompt(options.userHint) }],
  })
  const trimmed = raw.trim()
  try {
    let jsonStr = trimmed
    const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (fence?.[1]) jsonStr = fence[1].trim()
    const v = JSON.parse(jsonStr) as unknown
    if (!isObject(v)) return null
    const prompt = typeof v.prompt === 'string' ? v.prompt.trim() : ''
    const expected = typeof v.expected === 'string' ? v.expected.trim() : ''
    if (!prompt || !expected) return null
    return { prompt, expected }
  } catch {
    return null
  }
}

export function summarizeRunItems(items: EvaluationRunItem[]): EvaluationRunSummary {
  const total = items.length
  const passed = items.filter((i) => i.pass && !i.error).length
  const failed = total - passed
  const scores = items.filter((i) => !i.error).map((i) => i.score)
  const avgScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0
  return {
    total,
    passed,
    failed,
    avgScore: Math.round(avgScore * 10) / 10,
  }
}

export async function loadModelSkinContext(): Promise<{
  defaultProviderId: string | null
  skinId: ChatSkinId
  personaEnabled: boolean
}> {
  const [model, cfg] = await Promise.all([loadModelConfig(), loadConfig()])
  return {
    defaultProviderId: model?.defaultProviderId ?? null,
    skinId: normalizeChatSkinId(cfg.chatUiSkin),
    personaEnabled: cfg.chatUiPersonaEnabled && cfg.chatUiSkin !== 'default',
  }
}

/** Compact trace for judge prompt (avoid huge prompts). */
export function compactTraceForJudge(debugLogs: string[], toolTraces: string[]): string {
  const parts: string[] = []
  if (toolTraces.length) {
    parts.push('Tools:\n' + toolTraces.join('\n'))
  }
  if (debugLogs.length) {
    const tail = debugLogs.slice(-40)
    parts.push('Debug (tail):\n' + tail.join('\n\n'))
  }
  const s = parts.join('\n\n')
  return s.length > 12000 ? `${s.slice(0, 12000)}\n…(truncated)` : s
}

export function patchSuite(
  store: EvaluationStoreData,
  suiteId: string,
  patch: Partial<Pick<EvaluationSuite, 'name' | 'description' | 'cases'>>,
): EvaluationStoreData {
  const t = nowMs()
  const suites = store.suites.map((s) =>
    s.id === suiteId ? { ...s, ...patch, updatedAt: t } : s,
  )
  return { ...store, suites }
}

export function upsertRun(store: EvaluationStoreData, run: EvaluationRun): EvaluationStoreData {
  const rest = store.runs.filter((r) => r.id !== run.id)
  return { ...store, runs: [run, ...rest] }
}

export function deleteRunById(store: EvaluationStoreData, runId: string): EvaluationStoreData {
  return { ...store, runs: store.runs.filter((r) => r.id !== runId) }
}
