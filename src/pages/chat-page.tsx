import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import i18n from '@/i18n'
import {
  Copy,
  History,
  Lightbulb,
  Loader2,
  MessageSquarePlus,
  Mic,
  Paperclip,
  Pencil,
  Sparkles,
  Trash2,
  ArrowUp,
  ChevronDown,
  ChevronRight,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ChatMarkdown } from '@/components/chat-markdown'
import {
  completeChat,
  loadChatStore,
  saveChatStore,
  streamChat,
  type ChatMessage,
  type ChatSession,
  type ChatStoreData,
} from '@/lib/chat-api'
import { loadModelConfig, type ModelConfig } from '@/lib/model-config'
import { cn } from '@/lib/utils'

const MAX_INPUT_CHARS = 10000
const TITLE_MAX = 40
const KEEP_TURNS_AFTER_COMPACT = 2

function newId(): string {
  return crypto.randomUUID()
}

function nowMs(): number {
  return Date.now()
}

function bumpSessionInStore(
  base: ChatStoreData,
  sid: string,
  patch: Partial<ChatSession>,
): ChatStoreData {
  const nextSessions = base.sessions.map((x) =>
    x.id === sid ? { ...x, ...patch, updatedAt: nowMs() } : x,
  )
  nextSessions.sort((a, b) => b.updatedAt - a.updatedAt)
  return { ...base, sessions: nextSessions }
}

type SlashDef = { cmd: string; labelKey: string; descKey: string }

export function ChatPage() {
  const { t } = useTranslation()
  const [store, setStore] = useState<ChatStoreData | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [modelConfig, setModelConfig] = useState<ModelConfig | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [slashHighlight, setSlashHighlight] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const copyText = useCallback(async (text: string) => {
    const t = text.trim()
    if (!t) return
    try {
      await navigator.clipboard.writeText(t)
      setToast('Copied')
    } catch {
      // no-op
    }
  }, [])

  const slashCommands: SlashDef[] = useMemo(
    () => [
      { cmd: '/clear', labelKey: 'chat.slash.clear', descKey: 'chat.slash.clear.desc' },
      {
        cmd: '/compact',
        labelKey: 'chat.slash.compact',
        descKey: 'chat.slash.compact.desc',
      },
      {
        cmd: '/approve',
        labelKey: 'chat.slash.approve',
        descKey: 'chat.slash.approve.desc',
      },
      { cmd: '/deny', labelKey: 'chat.slash.deny', descKey: 'chat.slash.deny.desc' },
    ],
    [],
  )

  const slashPrefix = useMemo(() => {
    const line = input.split('\n')[0]?.trimStart() ?? ''
    if (!line.startsWith('/')) return null
    const end = line.search(/\s/)
    const token = end === -1 ? line : line.slice(0, end)
    if (!token.startsWith('/')) return null
    return token
  }, [input])

  const slashFiltered = useMemo(() => {
    if (slashPrefix === null) return []
    return slashCommands.filter((c) => c.cmd.startsWith(slashPrefix))
  }, [slashCommands, slashPrefix])

  const showSlashPalette = slashPrefix !== null && slashFiltered.length > 0

  useEffect(() => {
    if (!showSlashPalette) return
    setSlashHighlight((h) => Math.min(h, slashFiltered.length - 1))
  }, [showSlashPalette, slashFiltered.length])

  const persist = useCallback(async (next: ChatStoreData) => {
    setStore(next)
    await saveChatStore(next)
  }, [])

  useEffect(() => {
    void (async () => {
      const [s, m] = await Promise.all([loadChatStore(), loadModelConfig()])
      setModelConfig(m)
      const titleNew = i18n.t('chat.newChatTitle')
      if (!s.sessions.length) {
        const id = newId()
        const session: ChatSession = {
          id,
          title: titleNew,
          updatedAt: nowMs(),
          pendingToolApproval: null,
        }
        const next: ChatStoreData = {
          sessions: [session],
          messages: { [id]: [] },
        }
        await persist(next)
        setActiveId(id)
        return
      }
      const sorted = [...s.sessions].sort((a, b) => b.updatedAt - a.updatedAt)
      setStore({ ...s, sessions: sorted })
      setActiveId(sorted[0]?.id ?? null)
    })()
  }, [persist])

  useEffect(() => {
    if (!toast) return
    const tmr = window.setTimeout(() => setToast(null), 3200)
    return () => window.clearTimeout(tmr)
  }, [toast])

  const messages = useMemo(() => {
    if (!store || !activeId) return []
    return store.messages[activeId] ?? []
  }, [store, activeId])

  const activeSession = useMemo(() => {
    if (!store || !activeId) return null
    return store.sessions.find((s) => s.id === activeId) ?? null
  }, [store, activeId])

  const ensureDefaultProvider = useCallback((): string | null => {
    return modelConfig?.defaultProviderId ?? null
  }, [modelConfig])

  const newChatSession = useCallback(async () => {
    if (!store) return
    const id = newId()
    const session: ChatSession = {
      id,
      title: t('chat.newChatTitle'),
      updatedAt: nowMs(),
      pendingToolApproval: null,
    }
    const next: ChatStoreData = {
      sessions: [session, ...store.sessions],
      messages: { ...store.messages, [id]: [] },
    }
    await persist(next)
    setActiveId(id)
    setHistoryOpen(false)
    setInput('')
    setError(null)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }, [store, persist, t])

  const openHistory = useCallback(() => {
    setHistoryOpen((v) => !v)
  }, [])

  const selectSession = useCallback((id: string) => {
    setActiveId(id)
    setHistoryOpen(false)
    setError(null)
  }, [])

  const deleteSession = useCallback(
    async (id: string) => {
      if (!store) return
      if (!window.confirm(t('chat.history.confirmDelete'))) return
      const nextSessions = store.sessions.filter((s) => s.id !== id)
      const nextMessages = { ...store.messages }
      delete nextMessages[id]
      let nextActive = activeId
      if (activeId === id) {
        nextActive = nextSessions[0]?.id ?? null
        if (!nextSessions.length) {
          const nid = newId()
          const session: ChatSession = {
            id: nid,
            title: t('chat.newChatTitle'),
            updatedAt: nowMs(),
            pendingToolApproval: null,
          }
          const next: ChatStoreData = {
            sessions: [session],
            messages: { [nid]: [] },
          }
          await persist(next)
          setActiveId(nid)
          return
        }
      }
      const next: ChatStoreData = {
        sessions: nextSessions.sort((a, b) => b.updatedAt - a.updatedAt),
        messages: nextMessages,
      }
      await persist(next)
      setActiveId(nextActive)
    },
    [store, activeId, persist, t],
  )

  const renameSession = useCallback(
    async (id: string) => {
      const s = store?.sessions.find((x) => x.id === id)
      const nextTitle = window.prompt(
        t('chat.history.rename'),
        s?.title ?? '',
      )
      if (nextTitle === null) return
      const trimmed = nextTitle.trim()
      if (!trimmed) return
      if (!store) return
      const next = bumpSessionInStore(store, id, { title: trimmed })
      await persist(next)
    },
    [store, persist, t],
  )

  const replaceMessages = useCallback(
    async (sid: string, list: ChatMessage[]) => {
      if (!store) return
      const bumped = bumpSessionInStore(store, sid, {})
      const next: ChatStoreData = {
        ...bumped,
        messages: { ...bumped.messages, [sid]: list },
      }
      await persist(next)
    },
    [store, persist],
  )

  const maybeSetTitleFromUser = useCallback(
    async (
      sid: string,
      userText: string,
      base: ChatStoreData,
    ): Promise<ChatStoreData> => {
      const session = base.sessions.find((s) => s.id === sid)
      if (!session) return base
      const isDefault =
        session.title === t('chat.newChatTitle') || !session.title.trim()
      if (!isDefault) return base
      const cleaned = userText.replace(/^\[[^\]]+\]\s*/, '').trim()
      if (!cleaned) return base
      const title = cleaned.slice(0, TITLE_MAX)
      const next = bumpSessionInStore(base, sid, { title })
      await persist(next)
      return next
    },
    [persist, t],
  )

  const takeLastTurns = useCallback((list: ChatMessage[], maxPairs: number) => {
    if (maxPairs <= 0) return []
    const out: ChatMessage[] = []
    let pairs = 0
    for (let i = list.length - 1; i >= 0 && pairs < maxPairs; i--) {
      const m = list[i]
      if (!m) break
      out.push(m)
      if (m.role === 'user') pairs++
    }
    out.reverse()
    return out
  }, [])

  const runCompact = useCallback(
    async (note: string) => {
      const pid = ensureDefaultProvider()
      if (!pid) {
        setError(t('chat.error.noProvider'))
        return
      }
      if (!activeId || !store) return
      const current = store.messages[activeId] ?? []
      if (!current.length) {
        setToast(t('chat.toast.cleared'))
        return
      }
      const historyText = current
        .map((m) => `${m.role}: ${m.content}`)
        .join('\n\n')
      const prefix = t('chat.compact.prompt')
      const extra = note.trim()
        ? `\n\n${t('chat.compact.noteLine')}：${note.trim()}`
        : ''
      const userPrompt = `${prefix}${extra}\n\n---\n${historyText}`
      setSending(true)
      setError(null)
      try {
        const summary = await completeChat({
          providerId: pid,
          messages: [{ role: 'user', content: userPrompt }],
        })
        const summaryMsg: ChatMessage = {
          id: newId(),
          role: 'system',
          content: `${t('chat.compact.systemPrefix')}\n${summary}`,
          createdAt: nowMs(),
        }
        const tail = takeLastTurns(current, KEEP_TURNS_AFTER_COMPACT)
        await replaceMessages(activeId, [summaryMsg, ...tail])
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setSending(false)
      }
    },
    [
      activeId,
      store,
      ensureDefaultProvider,
      replaceMessages,
      takeLastTurns,
      t,
    ],
  )

  const runClear = useCallback(async () => {
    if (!activeId || !store) return
    await replaceMessages(activeId, [])
    setToast(t('chat.toast.cleared'))
    setInput('')
  }, [activeId, store, replaceMessages, t])

  const handleApproveDeny = useCallback(
    async (kind: 'approve' | 'deny') => {
      if (!activeSession?.pendingToolApproval) {
        setToast(t('chat.toast.noPendingApproval'))
        setInput('')
        return
      }
      setToast(
        kind === 'approve'
          ? t('chat.toast.approveStub')
          : t('chat.toast.denyStub'),
      )
      setInput('')
      if (store && activeId) {
        const next = bumpSessionInStore(store, activeId, {
          pendingToolApproval: null,
        })
        await persist(next)
      }
    },
    [activeSession, store, activeId, persist, t],
  )

  const sendNormal = useCallback(
    async (text: string) => {
      const pid = ensureDefaultProvider()
      if (!pid) {
        setError(t('chat.error.noProvider'))
        return
      }
      if (!activeId || !store) return
      const sid = activeId
      const userMsg: ChatMessage = {
        id: newId(),
        role: 'user',
        content: text,
        createdAt: nowMs(),
      }
      let s = await maybeSetTitleFromUser(sid, text, store)
      const prev = s.messages[sid] ?? []
      const afterUser = [...prev, userMsg]
      const astId = newId()
      const assistantPlaceholder: ChatMessage = {
        id: astId,
        role: 'assistant',
        content: '',
        createdAt: nowMs(),
      }
      const withAssistant = [...afterUser, assistantPlaceholder]
      s = bumpSessionInStore(s, sid, {})
      s = { ...s, messages: { ...s.messages, [sid]: withAssistant } }
      await persist(s)

      const turns = afterUser.map((m) => ({
        role: m.role,
        content: m.content,
      }))
      setSending(true)
      setError(null)
      let thinkingAcc = ''
      let contentAcc = ''
      const patchAssistantInBase = (base: ChatStoreData): ChatStoreData => {
        const nextList = (base.messages[sid] ?? []).map((m) =>
          m.id === astId
            ? {
                ...m,
                content: contentAcc,
                thinking:
                  thinkingAcc.length > 0 ? thinkingAcc : undefined,
              }
            : m,
        )
        const bumped = bumpSessionInStore(base, sid, {})
        const next: ChatStoreData = {
          ...bumped,
          messages: { ...bumped.messages, [sid]: nextList },
        }
        return next
      }
      try {
        await streamChat({
          providerId: pid,
          messages: turns,
          onEvent: (e) => {
            if (e.event !== 'delta') return
            if (e.thinkingDelta) thinkingAcc += e.thinkingDelta
            if (e.contentDelta) contentAcc += e.contentDelta
            setStore((base) => {
              if (!base) return base
              return {
                ...base,
                messages: {
                  ...base.messages,
                  [sid]: (base.messages[sid] ?? []).map((m) =>
                    m.id === astId
                      ? {
                          ...m,
                          content: contentAcc,
                          thinking:
                            thinkingAcc.length > 0
                              ? thinkingAcc
                              : undefined,
                        }
                      : m,
                  ),
                },
              }
            })
          },
        })
        setStore((base) => {
          if (!base) return base
          const next = patchAssistantInBase(base)
          void saveChatStore(next)
          return next
        })
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        setStore((base) => {
          if (!base) return base
          const next = patchAssistantInBase(base)
          void saveChatStore(next)
          return next
        })
      } finally {
        setSending(false)
      }
    },
    [activeId, store, ensureDefaultProvider, maybeSetTitleFromUser, persist, t],
  )

  const onSubmit = useCallback(async () => {
    const raw = input.trimEnd()
    if (!raw || sending) return
    if (raw.length > MAX_INPUT_CHARS) return

    const first = raw.split('\n')[0]?.trim() ?? ''
    if (first.startsWith('/clear')) {
      await runClear()
      return
    }
    if (first.startsWith('/approve')) {
      void handleApproveDeny('approve')
      return
    }
    if (first.startsWith('/deny')) {
      void handleApproveDeny('deny')
      return
    }
    if (first.startsWith('/compact')) {
      const rest = raw.replace(/^\s*\/compact\s*/i, '').trim()
      await runCompact(rest)
      setInput('')
      return
    }

    setInput('')
    await sendNormal(raw)
  }, [
    input,
    sending,
    runClear,
    runCompact,
    sendNormal,
    handleApproveDeny,
  ])

  const onPickSlash = useCallback(
    (cmd: string) => {
      if (cmd === '/clear') {
        void runClear()
        return
      }
      if (cmd === '/approve' || cmd === '/deny' || cmd === '/compact') {
        setInput(`${cmd} `)
        requestAnimationFrame(() => textareaRef.current?.focus())
      }
    },
    [runClear],
  )

  const onKeyDownTextarea = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (showSlashPalette && slashFiltered.length) {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setSlashHighlight((i) => (i + 1) % slashFiltered.length)
          return
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          setSlashHighlight(
            (i) => (i - 1 + slashFiltered.length) % slashFiltered.length,
          )
          return
        }
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          const pick = slashFiltered[slashHighlight]
          if (pick) onPickSlash(pick.cmd)
          return
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          setInput((v) => v.replace(/^\/[^\s]*/, '').trimStart())
          return
        }
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        void onSubmit()
      }
    },
    [
      showSlashPalette,
      slashFiltered,
      slashHighlight,
      onPickSlash,
      onSubmit,
    ],
  )

  const fillSuggestion = useCallback((text: string) => {
    setInput(text)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }, [])

  if (!store || !activeId || !activeSession) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-slate-500">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    )
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {toast ? (
        <div className="pointer-events-none fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-900">
          {toast}
        </div>
      ) : null}

      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200/80 pb-3 dark:border-slate-800">
        <h1 className="truncate text-base font-semibold text-slate-900 dark:text-slate-100">
          {activeSession.title}
        </h1>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 w-9 p-0"
            onClick={() => void newChatSession()}
            aria-label={t('chat.header.new')}
          >
            <MessageSquarePlus className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 w-9 p-0"
            onClick={openHistory}
            aria-label={t('chat.header.history')}
          >
            <History className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col">
        {messages.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-8">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-orange-500/15 text-3xl">
              🐯
            </div>
            <div className="max-w-md text-center">
              <p className="text-lg font-medium text-slate-900 dark:text-slate-100">
                {t('chat.empty.greeting')}
              </p>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                {t('chat.empty.sub')}
              </p>
            </div>
            <div className="flex w-full max-w-md flex-col gap-2">
              <button
                type="button"
                onClick={() => fillSuggestion(t('chat.empty.prompt1'))}
                className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-left text-sm text-slate-800 shadow-sm transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
              >
                <Sparkles className="h-4 w-4 shrink-0 text-violet-500" />
                <span className="flex-1">{t('chat.empty.prompt1')}</span>
                <ChevronRight className="h-4 w-4 text-slate-400" />
              </button>
              <button
                type="button"
                onClick={() => fillSuggestion(t('chat.empty.prompt2'))}
                className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-left text-sm text-slate-800 shadow-sm transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
              >
                <Sparkles className="h-4 w-4 shrink-0 text-violet-500" />
                <span className="flex-1">{t('chat.empty.prompt2')}</span>
                <ChevronRight className="h-4 w-4 text-slate-400" />
              </button>
            </div>
          </div>
        ) : (
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto py-4">
            {messages.map((m) => (
              <div
                key={m.id}
                className={cn(
                  'flex',
                  m.role === 'user' ? 'justify-end' : 'justify-start',
                )}
              >
                <div
                  className={cn(
                    m.role === 'assistant'
                      ? 'w-full rounded-2xl px-4 py-2.5 text-sm leading-relaxed'
                      : 'max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
                    m.role === 'user'
                      ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                      : m.role === 'system'
                        ? 'border border-amber-200/80 bg-amber-50 text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100'
                        : 'border border-slate-200 bg-white text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100',
                  )}
                >
                  <span className="mb-0.5 block text-[10px] font-medium uppercase tracking-wide opacity-70">
                    {m.role === 'user'
                      ? t('chat.role.user')
                      : m.role === 'assistant'
                        ? t('chat.role.assistant')
                        : 'System'}
                  </span>
                  {m.role === 'assistant' ? (
                    <>
                      {m.thinking ? (
                        <details
                          className="group mb-3 rounded-xl border border-slate-200/90 bg-slate-50 px-3 py-2 dark:border-slate-600/60 dark:bg-slate-800/50"
                        >
                          <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-medium text-slate-500 outline-none dark:text-slate-400 [&::-webkit-details-marker]:hidden">
                            <Lightbulb className="h-3.5 w-3.5 shrink-0" />
                            <span>{t('chat.thinking.label')}</span>
                            <ChevronDown className="ml-auto h-4 w-4 shrink-0 opacity-60 transition-transform group-open:-rotate-180" />
                          </summary>
                          <div className="mt-2 border-t border-slate-200/70 pt-2 text-slate-600 dark:border-slate-600/60 dark:text-slate-400">
                            <ChatMarkdown text={m.thinking} />
                          </div>
                        </details>
                      ) : null}
                      {m.content.trim() === '' &&
                      !(m.thinking && m.thinking.length > 0) &&
                      sending ? (
                        <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
                          <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                          <span>{t('chat.sending')}</span>
                        </div>
                      ) : (
                        <ChatMarkdown text={m.content} />
                      )}
                      <div className="mt-2 flex items-center justify-start">
                        <button
                          type="button"
                          onClick={() =>
                            void copyText(
                              [
                                m.thinking ? `# ${t('chat.thinking.label')}\n${m.thinking}\n` : '',
                                m.content,
                              ]
                                .filter(Boolean)
                                .join('\n'),
                            )
                          }
                          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                          aria-label="Copy"
                        >
                          <Copy className="h-3.5 w-3.5" />
                          <span>Copy</span>
                        </button>
                      </div>
                    </>
                  ) : (
                    <p className="whitespace-pre-wrap">{m.content}</p>
                  )}
                </div>
              </div>
            ))}
            {sending &&
            (!messages.length ||
              messages[messages.length - 1]?.role !== 'assistant') ? (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('chat.sending')}
                </div>
              </div>
            ) : null}
          </div>
        )}

        {error ? (
          <p className="shrink-0 text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        ) : null}

        <div className="relative mt-2 shrink-0 pb-1">
          {showSlashPalette ? (
            <div className="absolute bottom-full left-0 right-0 z-40 mb-2 max-h-56 overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
              {slashFiltered.map((item, idx) => (
                <button
                  key={item.cmd}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onPickSlash(item.cmd)}
                  className={cn(
                    'flex w-full gap-3 px-3 py-2.5 text-left text-sm transition',
                    idx === slashHighlight
                      ? 'bg-amber-100/80 dark:bg-amber-900/40'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800',
                  )}
                >
                  <span className="shrink-0 font-semibold text-orange-600 dark:text-orange-400">
                    {t(item.labelKey)}
                  </span>
                  <span className="text-slate-500 dark:text-slate-400">
                    {t(item.descKey)}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
          <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDownTextarea}
              placeholder={t('chat.input.placeholder')}
              rows={3}
              maxLength={MAX_INPUT_CHARS}
              className="w-full resize-none bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400 dark:text-slate-100"
            />
            <div className="mt-2 flex items-end justify-between gap-2">
              <div className="flex gap-1">
                <button
                  type="button"
                  disabled
                  className="rounded-lg p-2 text-slate-400 opacity-50"
                  aria-label="Voice"
                >
                  <Mic className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  disabled
                  className="rounded-lg p-2 text-slate-400 opacity-50"
                  aria-label="Attach"
                >
                  <Paperclip className="h-4 w-4" />
                </button>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">
                  {input.length}/{MAX_INPUT_CHARS}
                </span>
                <Button
                  type="button"
                  size="sm"
                  className="h-9 w-9 p-0"
                  disabled={
                    sending || !input.trim() || input.length > MAX_INPUT_CHARS
                  }
                  onClick={() => void onSubmit()}
                  aria-label={t('chat.send')}
                >
                  {sending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ArrowUp className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {historyOpen ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 bg-black/20"
            aria-label="Close"
            onClick={() => setHistoryOpen(false)}
          />
          <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col border-l border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-950">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
              <h2 className="text-sm font-semibold">{t('chat.history.title')}</h2>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8"
                onClick={() => setHistoryOpen(false)}
              >
                ×
              </Button>
            </div>
            <div className="p-3">
              <Button
                type="button"
                className="w-full bg-orange-500 text-white hover:bg-orange-600 dark:bg-orange-600 dark:hover:bg-orange-500"
                onClick={() => void newChatSession()}
              >
                {t('chat.history.new')}
              </Button>
            </div>
            <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
              {store.sessions.map((s) => (
                <li key={s.id} className="relative pl-4">
                  <span className="absolute left-1 top-3 h-2 w-2 rounded-full bg-orange-500" />
                  <span className="absolute left-[7px] top-6 bottom-0 w-px bg-slate-200 dark:bg-slate-800" />
                  <div
                    className={cn(
                      'relative mb-2 rounded-lg border p-3 transition',
                      s.id === activeId
                        ? 'border-orange-300 bg-orange-50/60 dark:border-orange-800 dark:bg-orange-950/30'
                        : 'border-transparent bg-slate-50 hover:bg-slate-100 dark:bg-slate-900 dark:hover:bg-slate-800',
                    )}
                  >
                    <button
                      type="button"
                      className="w-full text-left"
                      onClick={() => selectSession(s.id)}
                    >
                      <div className="pr-16 font-medium text-slate-900 dark:text-slate-100">
                        {s.title}
                      </div>
                      <div className="mt-1 text-[11px] text-slate-500">
                        {new Date(s.updatedAt).toLocaleString()}
                      </div>
                    </button>
                    <div className="absolute right-3 top-3 flex gap-1">
                      <button
                        type="button"
                        className="rounded p-1 text-slate-500 hover:bg-white hover:text-slate-900 dark:hover:bg-slate-800"
                        aria-label={t('chat.history.rename')}
                        onClick={() => void renameSession(s.id)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        className="rounded p-1 text-slate-500 hover:bg-white hover:text-red-600 dark:hover:bg-slate-800"
                        aria-label={t('chat.history.delete')}
                        onClick={() => void deleteSession(s.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </aside>
        </>
      ) : null}
    </div>
  )
}
