import type { TFunction } from 'i18next'
import type { ChatMessage, ChatTurn } from '@/lib/chat-api'

export type ChatSkinId = 'default' | 'imperial' | 'journey_west' | 'three_kingdoms'

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

type ThematicSkinDef = {
  systemPersona: string
  zh: ChatSkinUiStrings
  en: ChatSkinUiStrings
}

const IMPERIAL: ThematicSkinDef = {
  systemPersona:
    '你是朝中辅臣，称用户为「陛下」，自称「臣」。用简练、现代可读的白话略带文言色彩作答，勿冗长。提及工具执行时，可比拟为各部院办事，但答复仍以清晰为先。',
  zh: {
    inputBanner: '拟写圣旨',
    placeholder: '奏陈国事，输入 / 可调内廷指令…',
    roleUser: '陛下',
    roleAssistant: '辅臣',
    thinkingLabel: '揣度',
    emptyGreeting: '陛下，臣恭聆圣谕。',
    emptySub: '请示下——军国机要、典籍查阅，臣当竭力。',
    sendAria: '宣旨',
    toolStatusCalling: '衙署办理中',
    toolStatusOk: '回旨',
    toolStatusError: '廷议未谐',
    toolIoToggle: '案卷',
    toolIoInput: '呈文',
    toolIoOutput: '回文',
  },
  en: {
    inputBanner: 'Draft edict',
    placeholder: 'State your decree, or type / for shortcuts…',
    roleUser: 'Your Majesty',
    roleAssistant: 'Minister',
    thinkingLabel: 'Counsel',
    emptyGreeting: 'Your Majesty — your minister awaits.',
    emptySub: 'Ask of statecraft, archives, or any task.',
    sendAria: 'Proclaim',
    toolStatusCalling: 'In progress',
    toolStatusOk: 'Done',
    toolStatusError: 'Failed',
    toolIoToggle: 'Docket',
    toolIoInput: 'Memorial',
    toolIoOutput: 'Response',
  },
}

const JOURNEY_WEST: ThematicSkinDef = {
  systemPersona:
    '你是取经路上的护法行者口吻，称用户为「师父」，自称「俺老孙」或「老孙」皆可。用语诙谐、口语化，可夹杂西游典故；宜短句。工具可为「法宝」「神通」类比，勿喧宾夺主。',
  zh: {
    inputBanner: '取经帖',
    placeholder: '师父有甚吩咐，或输入 / 唤筋斗…',
    roleUser: '师父',
    roleAssistant: '行者',
    thinkingLabel: '掐诀',
    emptyGreeting: '师父，老孙在此。',
    emptySub: '赶路取经也好，查经问难也罢，说来便是。',
    sendAria: '念咒',
    toolStatusCalling: '神通施展中',
    toolStatusOk: '功成',
    toolStatusError: '撞上妖风',
    toolIoToggle: '法宝详单',
    toolIoInput: '咒语/入参',
    toolIoOutput: '显圣/出参',
  },
  en: {
    inputBanner: 'Travel writ',
    placeholder: 'Master, your request — or type / for shortcuts…',
    roleUser: 'Master',
    roleAssistant: 'Pilgrim',
    thinkingLabel: 'Meditation',
    emptyGreeting: 'Master — the pilgrim is ready.',
    emptySub: 'Journey, lore, or chores — speak freely.',
    sendAria: 'Cast',
    toolStatusCalling: 'Channeling',
    toolStatusOk: 'Success',
    toolStatusError: 'Hexed',
    toolIoToggle: 'Relic details',
    toolIoInput: 'Incantation',
    toolIoOutput: 'Manifest',
  },
}

const THREE_KINGDOMS: ThematicSkinDef = {
  systemPersona:
    '你是帐下谋士视角，称用户为「主公」，自称「在下」或「末将」皆可。语气偏古风而仍现代可读；议事简洁。工具可比斥候、辎重、谍报，勿堆砌。',
  zh: {
    inputBanner: '军机密启',
    placeholder: '主公明示方略，或输入 / 调号令…',
    roleUser: '主公',
    roleAssistant: '谋士',
    thinkingLabel: '筹策',
    emptyGreeting: '主公，末将听令。',
    emptySub: '军机、文书、舆图之事，均可裁处。',
    sendAria: '发令',
    toolStatusCalling: '行军中',
    toolStatusOk: '报捷',
    toolStatusError: '失利',
    toolIoToggle: '文书',
    toolIoInput: '军牒',
    toolIoOutput: '回传',
  },
  en: {
    inputBanner: 'War council',
    placeholder: 'My lord — your orders, or type / for shortcuts…',
    roleUser: 'My lord',
    roleAssistant: 'Strategist',
    thinkingLabel: 'Strategize',
    emptyGreeting: 'My lord — the strategist attends.',
    emptySub: 'Orders, maps, or letters — say the word.',
    sendAria: 'Dispatch',
    toolStatusCalling: 'Marching',
    toolStatusOk: 'Victory',
    toolStatusError: 'Rout',
    toolIoToggle: 'Scroll',
    toolIoInput: 'Dispatch',
    toolIoOutput: 'Report',
  },
}

const THEMATIC: Record<Exclude<ChatSkinId, 'default'>, ThematicSkinDef> = {
  imperial: IMPERIAL,
  journey_west: JOURNEY_WEST,
  three_kingdoms: THREE_KINGDOMS,
}

export function normalizeChatSkinId(raw: string | undefined | null): ChatSkinId {
  if (raw === 'imperial' || raw === 'journey_west' || raw === 'three_kingdoms') {
    return raw
  }
  return 'default'
}

/** Sets `data-chat-skin` on `<html>` so shell, sidebar, chat, and dialogs can share palette. */
export function applyChatSkin(raw: string | undefined | null): void {
  const id = normalizeChatSkinId(raw ?? 'default')
  document.documentElement.setAttribute('data-chat-skin', id)
}

export function getChatSkinSystemPersona(id: ChatSkinId): string {
  if (id === 'default') return ''
  return THEMATIC[id].systemPersona
}

export function getSkinUiStrings(
  id: ChatSkinId,
  lang: 'zh' | 'en',
  t: TFunction,
): ChatSkinUiStrings {
  if (id === 'default') {
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
  const pack = THEMATIC[id]
  return lang === 'en' ? pack.en : pack.zh
}

type ToolLabelRow = { match: (n: string) => boolean; label: string }

function rowsImperial(): ToolLabelRow[] {
  return [
    { match: (n) => n.includes('browser') || n.includes('fetch') || n.includes('web'), label: '兵部巡察' },
    { match: (n) => n.includes('read') || n.includes('file') || n.includes('open'), label: '户部阅档' },
    { match: (n) => n.includes('write') || n.includes('edit') || n.includes('apply_patch'), label: '工部缮写' },
    { match: (n) => n.includes('screenshot') || n.includes('capture'), label: '礼部留影' },
    { match: (n) => n.includes('search') || n.includes('grep') || n.includes('find'), label: '吏部搜访' },
    { match: (n) => n.includes('weather'), label: '钦天监观象' },
    { match: (n) => n.includes('run') || n.includes('exec') || n.includes('terminal') || n.includes('shell'), label: '都察院勘验' },
    { match: (n) => n.includes('list') || n.includes('dir') || n.includes('glob'), label: '户部清点' },
    { match: (n) => n.includes('mcp'), label: '通政司传檄' },
  ]
}

function rowsJourney(): ToolLabelRow[] {
  return [
    { match: (n) => n.includes('browser') || n.includes('fetch') || n.includes('web'), label: '千里眼巡山' },
    { match: (n) => n.includes('read') || n.includes('file'), label: '揭帖观文' },
    { match: (n) => n.includes('write') || n.includes('edit') || n.includes('apply_patch'), label: '金箍画字' },
    { match: (n) => n.includes('screenshot'), label: '照妖镜留影' },
    { match: (n) => n.includes('search') || n.includes('grep'), label: '掐诀寻人' },
    { match: (n) => n.includes('weather'), label: '问风婆雨师' },
    { match: (n) => n.includes('run') || n.includes('exec') || n.includes('terminal'), label: '拘山神土地' },
    { match: (n) => n.includes('list') || n.includes('dir') || n.includes('glob'), label: '火眼清点' },
    { match: (n) => n.includes('mcp'), label: '南海传音' },
  ]
}

function rowsThree(): ToolLabelRow[] {
  return [
    { match: (n) => n.includes('browser') || n.includes('fetch') || n.includes('web'), label: '水军斥候' },
    { match: (n) => n.includes('read') || n.includes('file'), label: '简牍披览' },
    { match: (n) => n.includes('write') || n.includes('edit') || n.includes('apply_patch'), label: '军书草拟' },
    { match: (n) => n.includes('screenshot'), label: '画影图形' },
    { match: (n) => n.includes('search') || n.includes('grep'), label: '细作打探' },
    { match: (n) => n.includes('weather'), label: '观云望气' },
    { match: (n) => n.includes('run') || n.includes('exec') || n.includes('terminal'), label: '阵前试刃' },
    { match: (n) => n.includes('list') || n.includes('dir') || n.includes('glob'), label: '辎重清点' },
    { match: (n) => n.includes('mcp'), label: '驿马传书' },
  ]
}

const TOOL_ROWS: Record<Exclude<ChatSkinId, 'default'>, ToolLabelRow[]> = {
  imperial: rowsImperial(),
  journey_west: rowsJourney(),
  three_kingdoms: rowsThree(),
}

export function labelForToolName(skinId: ChatSkinId, name: string): string {
  if (skinId === 'default') return name
  const n = name.toLowerCase()
  for (const row of TOOL_ROWS[skinId]) {
    if (row.match(n)) return row.label
  }
  return name
}

export function buildApiTurns(
  messages: ChatMessage[],
  skinId: ChatSkinId,
  personaEnabled: boolean,
): ChatTurn[] {
  const mapped: ChatTurn[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }))
  const persona = getChatSkinSystemPersona(skinId)
  if (personaEnabled && persona.trim().length > 0) {
    return [{ role: 'system', content: persona }, ...mapped]
  }
  return mapped
}
