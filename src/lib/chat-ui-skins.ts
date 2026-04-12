import type { TFunction } from 'i18next'
import type { ChatMessage, ChatTurn } from '@/lib/chat-api'

export const CHAT_SKIN_IDS = [
  'default',
  'animal-world',
  'elegant',
] as const
export type ChatSkinId = (typeof CHAT_SKIN_IDS)[number]

export function parseChatSkinId(value: string | undefined): ChatSkinId {
  if (value === 'animal-world') return 'animal-world'
  if (value === 'elegant') return 'elegant'
  if (value === 'robot') return 'default'
  return 'default'
}

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

export function applyChatSkin(skin: ChatSkinId): void {
  document.documentElement.setAttribute('data-chat-skin', skin)
}

export function getSkinUiStrings(
  t: TFunction,
  skin: ChatSkinId,
): ChatSkinUiStrings {
  if (skin === 'elegant') {
    return {
      inputBanner: t('chat.skin.elegant.banner'),
      placeholder: t('chat.skin.elegant.placeholder'),
      roleUser: t('chat.role.user'),
      roleAssistant: t('chat.skin.elegant.roleAssistant'),
      thinkingLabel: t('chat.thinking.label'),
      emptyGreeting: t('chat.skin.elegant.emptyGreeting'),
      emptySub: t('chat.skin.elegant.emptySub'),
      sendAria: t('chat.send'),
      toolStatusCalling: t('chat.tool.status.calling'),
      toolStatusOk: t('chat.tool.status.ok'),
      toolStatusError: t('chat.tool.status.error'),
      toolIoToggle: t('chat.tool.io.toggle'),
      toolIoInput: t('chat.tool.io.input'),
      toolIoOutput: t('chat.tool.io.output'),
    }
  }

  if (skin === 'animal-world') {
    return {
      inputBanner: t('chat.skin.animalWorld.banner'),
      placeholder: t('chat.skin.animalWorld.placeholder'),
      roleUser: t('chat.role.user'),
      roleAssistant: t('chat.skin.animalWorld.roleAssistant'),
      thinkingLabel: t('chat.thinking.label'),
      emptyGreeting: t('chat.skin.animalWorld.emptyGreeting'),
      emptySub: t('chat.skin.animalWorld.emptySub'),
      sendAria: t('chat.send'),
      toolStatusCalling: t('chat.tool.status.calling'),
      toolStatusOk: t('chat.tool.status.ok'),
      toolStatusError: t('chat.tool.status.error'),
      toolIoToggle: t('chat.tool.io.toggle'),
      toolIoInput: t('chat.tool.io.input'),
      toolIoOutput: t('chat.tool.io.output'),
    }
  }

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
