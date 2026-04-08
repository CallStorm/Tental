import { invoke } from '@tauri-apps/api/core'

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
