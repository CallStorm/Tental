import { Channel, invoke } from '@tauri-apps/api/core'

export type ChatSession = {
  id: string
  title: string
  updatedAt: number
  pendingToolApproval?: unknown | null
}

export type ChatMessage = {
  id: string
  role: string
  content: string
  createdAt: number
  thinking?: string
}

export type ChatStoreData = {
  sessions: ChatSession[]
  messages: Record<string, ChatMessage[]>
}

export async function loadChatStore(): Promise<ChatStoreData> {
  const raw = await invoke<ChatStoreData>('load_chat_store')
  return {
    sessions: Array.isArray(raw.sessions) ? raw.sessions : [],
    messages:
      raw.messages && typeof raw.messages === 'object' ? raw.messages : {},
  }
}

export async function saveChatStore(store: ChatStoreData): Promise<void> {
  await invoke('save_chat_store', { store })
}

export type ChatTurn = { role: string; content: string }

export async function completeChat(payload: {
  providerId?: string | null
  messages: ChatTurn[]
}): Promise<string> {
  return invoke<string>('complete_chat', {
    req: {
      providerId: payload.providerId ?? null,
      messages: payload.messages,
    },
  })
}

/** Payload from `stream_chat` (camelCase). */
export type StreamChatEvent = {
  event: string
  thinkingDelta?: string
  contentDelta?: string
  message?: string
}

/**
 * Stream a chat completion. `onEvent` receives each payload; resolves on `done`,
 * rejects on Rust/IPC failure or an `error` event.
 */
export async function streamChat(options: {
  providerId?: string | null
  messages: ChatTurn[]
  onEvent: (e: StreamChatEvent) => void
}): Promise<void> {
  let failed = false
  return new Promise((resolve, reject) => {
    const channel = new Channel<StreamChatEvent>((msg) => {
      options.onEvent(msg)
      if (msg.event === 'error') {
        failed = true
        reject(new Error(msg.message ?? 'stream error'))
        return
      }
      if (msg.event === 'done' && !failed) {
        resolve()
      }
    })
    invoke('stream_chat', {
      providerId: options.providerId ?? null,
      messages: options.messages,
      channel,
    }).catch((err) => {
      if (!failed) {
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })
  })
}
