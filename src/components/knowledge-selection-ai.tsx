import type { Editor } from '@tiptap/core'
import { BubbleMenu } from '@tiptap/react/menus'
import {
  CheckCircle2,
  CornerDownLeft,
  Copy,
  Languages,
  Loader2,
  RefreshCw,
  Send,
  Sparkles,
  Wand2,
  X,
} from 'lucide-react'
import { useCallback, useRef, useState, type ReactNode } from 'react'

import { markdownToHtml } from '@/lib/kb-doc-format'
import { completeChat, streamChat } from '@/lib/chat-api'
import { cn } from '@/lib/utils'

type AiMode = 'write' | 'translate' | 'explain'

type StoredRange = { from: number; to: number }

const MODE_LABELS: Record<AiMode, { bubble: string; pill: string; extraPlaceholder: string }> = {
  write: {
    bubble: '帮写',
    pill: '帮我扩写续写',
    extraPlaceholder: '可选：说明体裁、语气、长度、面向读者等，例如「扩写成两段，语气更正式」',
  },
  translate: {
    bubble: '翻译',
    pill: '帮我翻译一下',
    extraPlaceholder: '可选：目标语言或风格，例如「译成英文」「保留专有名词不译」',
  },
  explain: {
    bubble: '解读',
    pill: '帮我解读内容',
    extraPlaceholder: '可选：侧重方向，例如「偏学术」「给初学者」「只要要点」',
  },
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function selectionToInsertHtml(text: string): string {
  const t = text.trim()
  if (!t) return '<p></p>'
  if (/[#*_`\[\]]/.test(t)) {
    return markdownToHtml(t)
  }
  return t
    .split(/\n/)
    .map((line) => `<p>${escapeHtml(line) || '<br>'}</p>`)
    .join('')
}

function buildMessages(mode: AiMode, selection: string, userExtra: string) {
  const body = selection.trim()
  const extra = userExtra.trim()
  const extraBlock = extra ? `\n\n【补充说明与要求】\n${extra}` : ''
  switch (mode) {
    case 'write':
      return [
        {
          role: 'user',
          content: `你是写作助手。根据下面【选中内容】进行扩写或续写，保持语气和体裁一致，直接输出正文，不要任何开场白或结尾说明。${extraBlock}\n\n【选中内容】\n${body}`,
        },
      ]
    case 'translate':
      return [
        {
          role: 'user',
          content: `翻译以下【选中内容】（中文与英文互译优先）。只输出译文，不要解释或前缀。${extraBlock}\n\n【选中内容】\n${body}`,
        },
      ]
    case 'explain':
      return [
        {
          role: 'user',
          content: `请解读以下【选中内容】：含义、要点，必要时补充背景。可用 Markdown（小标题、列表）。直接输出解读正文。${extraBlock}\n\n【选中内容】\n${body}`,
        },
      ]
    default:
      return [{ role: 'user', content: body }]
  }
}

function BubbleAction({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
    >
      <span className="text-slate-500 dark:text-slate-400">{icon}</span>
      {label}
    </button>
  )
}

export function KnowledgeSelectionAi({ editor }: { editor: Editor }) {
  const [modalOpen, setModalOpen] = useState(false)
  const [mode, setMode] = useState<AiMode>('translate')
  const [sourceText, setSourceText] = useState('')
  const [userExtra, setUserExtra] = useState('')
  const [resultText, setResultText] = useState('')
  const [hasSubmitted, setHasSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const rangeRef = useRef<StoredRange | null>(null)
  const abortRef = useRef(false)

  const closeModal = useCallback(() => {
    abortRef.current = true
    setModalOpen(false)
    setSourceText('')
    setUserExtra('')
    setResultText('')
    setError(null)
    setLoading(false)
    setHasSubmitted(false)
    rangeRef.current = null
  }, [])

  const openCompose = useCallback((m: AiMode, selected: string, range: StoredRange) => {
    abortRef.current = false
    setMode(m)
    setSourceText(selected)
    setUserExtra('')
    setResultText('')
    setError(null)
    setLoading(false)
    setHasSubmitted(false)
    rangeRef.current = range
    setModalOpen(true)
  }, [])

  const runStream = useCallback(async () => {
    if (!sourceText.trim() || !rangeRef.current) return
    abortRef.current = false
    setHasSubmitted(true)
    setResultText('')
    setError(null)
    setLoading(true)
    const messages = buildMessages(mode, sourceText, userExtra)
    let acc = ''
    try {
      await streamChat({
        messages,
        skillChannel: 'chat',
        onEvent: (e) => {
          if (abortRef.current) return
          if (e.contentDelta) {
            acc += e.contentDelta
            setResultText(acc)
          }
          if (e.event === 'error' && e.message) {
            setError(e.message)
          }
        },
      })
      if (abortRef.current) return
      if (!acc.trim()) {
        const fallback = await completeChat({ messages, skillChannel: 'chat' })
        if (!abortRef.current) setResultText(fallback.trim())
      }
    } catch (e) {
      if (abortRef.current) return
      try {
        const fallback = await completeChat({ messages, skillChannel: 'chat' })
        setResultText(fallback.trim())
        setError(null)
      } catch (e2) {
        setError(e2 instanceof Error ? e2.message : String(e2))
      }
    } finally {
      if (!abortRef.current) setLoading(false)
    }
  }, [mode, sourceText, userExtra])

  const openForMode = (m: AiMode) => {
    const { from, to } = editor.state.selection
    if (from === to) return
    const text = editor.state.doc.textBetween(from, to, '\n')
    if (!text.trim()) return
    openCompose(m, text, { from, to })
  }

  const applyReplace = () => {
    const r = rangeRef.current
    if (!r || !resultText.trim()) return
    const html = selectionToInsertHtml(resultText)
    editor
      .chain()
      .focus()
      .setTextSelection({ from: r.from, to: r.to })
      .insertContent(html)
      .run()
    closeModal()
  }

  const applyInsert = () => {
    const r = rangeRef.current
    if (!r || !resultText.trim()) return
    const html = selectionToInsertHtml(resultText)
    editor.chain().focus().setTextSelection(r.to).insertContent(`\n${html}`).run()
    closeModal()
  }

  const applyCopy = async () => {
    try {
      await navigator.clipboard.writeText(resultText.trim())
    } catch {
      // no-op
    }
  }

  const backToInput = () => {
    setHasSubmitted(false)
    setResultText('')
    setError(null)
    setLoading(false)
  }

  const regenerate = () => {
    void runStream()
  }

  const previewSnippet =
    sourceText.length > 600 ? `${sourceText.slice(0, 600)}…` : sourceText

  return (
    <>
      <BubbleMenu
        editor={editor}
        options={{
          placement: 'top',
          offset: 8,
          flip: true,
        }}
        shouldShow={({ editor: ed, state }) => {
          if (!ed.isEditable) return false
          const { from, to } = state.selection
          if (from === to) return false
          if (ed.isActive('codeBlock')) return false
          const t = state.doc.textBetween(from, to, ' ').trim()
          return t.length > 0
        }}
        className="flex items-center gap-0.5 rounded-xl border border-slate-200/90 bg-white px-1 py-1 shadow-lg dark:border-slate-600 dark:bg-slate-900"
      >
        <BubbleAction
          icon={<Wand2 className="h-3.5 w-3.5" />}
          label="帮写"
          onClick={() => openForMode('write')}
        />
        <BubbleAction
          icon={<Languages className="h-3.5 w-3.5" />}
          label="翻译"
          onClick={() => openForMode('translate')}
        />
        <BubbleAction
          icon={<Sparkles className="h-3.5 w-3.5" />}
          label="解读"
          onClick={() => openForMode('explain')}
        />
      </BubbleMenu>

      {modalOpen ? (
        <div
          className="fixed inset-0 z-[280] flex items-center justify-center bg-black/45 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal()
          }}
        >
          <div
            className="flex max-h-[min(90vh,720px)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
            role="dialog"
            aria-modal="true"
            aria-labelledby="kb-ai-modal-title"
          >
            <div className="flex items-start justify-between gap-2 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
              <div className="min-w-0 flex-1">
                <div id="kb-ai-modal-title" className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300">
                    <Sparkles className="h-4 w-4" />
                  </span>
                  Tental · AI
                </div>
                <div className="mt-2 inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  {MODE_LABELS[mode].pill}
                </div>
              </div>
              <button
                type="button"
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
                aria-label="关闭"
                onClick={closeModal}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              {!hasSubmitted ? (
                <div className="space-y-3">
                  <div>
                    <p className="mb-1 text-xs font-medium text-slate-500 dark:text-slate-400">选中文本</p>
                    <div className="max-h-36 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200">
                      <pre className="whitespace-pre-wrap font-sans">{previewSnippet}</pre>
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
                      补充说明（可选）
                    </label>
                    <textarea
                      value={userExtra}
                      onChange={(e) => setUserExtra(e.target.value)}
                      placeholder={MODE_LABELS[mode].extraPlaceholder}
                      rows={4}
                      className="w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
                    />
                  </div>
                </div>
              ) : (
                <>
                  {error ? (
                    <p className="mb-2 text-sm text-red-600 dark:text-red-400">{error}</p>
                  ) : null}
                  {loading && !resultText ? (
                    <div className="flex items-center gap-2 text-sm text-slate-500">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      生成中…
                    </div>
                  ) : null}
                  <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800 dark:text-slate-100">
                    {resultText || (loading ? '…' : '')}
                  </div>
                </>
              )}
            </div>

            {!hasSubmitted ? (
              <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-4 py-3 dark:border-slate-800">
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
                  disabled={!sourceText.trim()}
                  onClick={() => void runStream()}
                >
                  <Send className="h-4 w-4" />
                  发送
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-4 py-2 dark:border-slate-800">
                <button
                  type="button"
                  disabled={!resultText.trim() || loading}
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 dark:text-emerald-400 dark:hover:bg-emerald-950/40"
                  onClick={() => applyReplace()}
                >
                  <CheckCircle2 className="h-4 w-4" />
                  替换
                </button>
                <button
                  type="button"
                  disabled={!resultText.trim() || loading}
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 dark:text-emerald-400 dark:hover:bg-emerald-950/40"
                  onClick={() => applyInsert()}
                >
                  <CornerDownLeft className="h-4 w-4" />
                  插入
                </button>
                <button
                  type="button"
                  disabled={!resultText.trim()}
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 dark:text-emerald-400 dark:hover:bg-emerald-950/40"
                  onClick={() => void applyCopy()}
                >
                  <Copy className="h-4 w-4" />
                  复制
                </button>
                <div className="ml-auto flex items-center gap-1">
                  <button
                    type="button"
                    title="返回编辑补充说明"
                    disabled={loading}
                    className="rounded-lg px-2 py-1.5 text-xs text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                    onClick={() => backToInput()}
                  >
                    返回编辑
                  </button>
                  <button
                    type="button"
                    title="重新生成"
                    disabled={loading || !sourceText}
                    className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-40 dark:hover:bg-slate-800"
                    onClick={() => regenerate()}
                  >
                    <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
                  </button>
                </div>
              </div>
            )}

            <div className="border-t border-slate-50 px-4 py-2 dark:border-slate-800/80">
              <p className="text-center text-[10px] text-slate-400 dark:text-slate-500">
                内容由 AI 生成仅供参考
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
