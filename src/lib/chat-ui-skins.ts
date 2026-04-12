import type { TFunction } from 'i18next'
import type { ChatMessage, ChatTurn } from '@/lib/chat-api'

export type ChatSkinUiStrings = {
  /** Decorative label above input; null hides banner row */
  inputBanner: string | null
  placeholder: string
  roleUser: string
  roleAssistant: string
  thinkingLabel: string
  emptyGreeting: string
  emptySub: string
  sendAria: string
  toolStatusCalling: string
  toolStatusOk: string
  toolStatusError: string
  toolIoToggle: string
  toolIoInput: string
  toolIoOutput: string
}

/** Ensures `<html>` is not stuck on a removed themed skin from older sessions. */
export function applyChatSkin(): void {
  document.documentElement.setAttribute('data-chat-skin', 'default')
}

export function getSkinUiStrings(t: TFunction): ChatSkinUiStrings {
  return {
    inputBanner: null,
    placeholder: t('chat.input.placeholder'),
    roleUser: t('chat.role.user'),
    roleAssistant: t('chat.role.assistant'),
    thinkingLabel: t('chat.thinking.label'),
    emptyGreeting: t('chat.empty.greeting'),
    emptySub: t('chat.empty.sub'),
    sendAria: t('chat.send'),
    toolStatusCalling: t('chat.tool.status.calling'),
    toolStatusOk: t('chat.tool.status.ok'),
    toolStatusError: t('chat.tool.status.error'),
    toolIoToggle: t('chat.tool.io.toggle'),
    toolIoInput: t('chat.tool.io.input'),
    toolIoOutput: t('chat.tool.io.output'),
  }
}

export function buildApiTurns(messages: ChatMessage[]): ChatTurn[] {
  return messages.map((m) => ({
    role: m.role,
    content: m.content,
  }))
}
