import { invoke } from '@tauri-apps/api/core'
import { parseChatSkinId, type ChatSkinId } from '@/lib/chat-ui-skins'

export type AppConfig = {
  /** Fixed light mode only (persisted for backward compatibility). */
  theme: 'light'
  chatSkin: ChatSkinId
  language: 'zh' | 'en'
  agent: AgentConfig
}

export type AgentConfig = {
  language: 'zh' | 'en'
  maxIterations: number
  maxContextTokens: number
  autoRetryEnabled: boolean
  maxRetryCount: number
  /** L1 skill catalog: `minimal` | `full_yaml` */
  skillCatalogMode: string
  skillL1MaxChars: number
  skillBodyMaxChars: number
}

export const defaultAgentConfig: AgentConfig = {
  language: 'zh',
  maxIterations: 6,
  maxContextTokens: 12000,
  autoRetryEnabled: true,
  maxRetryCount: 2,
  skillCatalogMode: 'minimal',
  skillL1MaxChars: 12000,
  skillBodyMaxChars: 200000,
}

export const defaultConfig: AppConfig = {
  theme: 'light',
  chatSkin: 'default',
  language: 'zh',
  agent: defaultAgentConfig,
}

export async function loadConfig(): Promise<AppConfig> {
  try {
    const config = await invoke<AppConfig>('load_config')
    return {
      theme: 'light',
      chatSkin: parseChatSkinId(config.chatSkin as string | undefined),
      language: config.language ?? defaultConfig.language,
      agent: {
        language: config.agent?.language ?? defaultAgentConfig.language,
        maxIterations:
          typeof config.agent?.maxIterations === 'number'
            ? config.agent.maxIterations
            : defaultAgentConfig.maxIterations,
        maxContextTokens:
          typeof config.agent?.maxContextTokens === 'number'
            ? config.agent.maxContextTokens
            : defaultAgentConfig.maxContextTokens,
        autoRetryEnabled:
          typeof config.agent?.autoRetryEnabled === 'boolean'
            ? config.agent.autoRetryEnabled
            : defaultAgentConfig.autoRetryEnabled,
        maxRetryCount:
          typeof config.agent?.maxRetryCount === 'number'
            ? config.agent.maxRetryCount
            : defaultAgentConfig.maxRetryCount,
        skillCatalogMode:
          typeof config.agent?.skillCatalogMode === 'string' &&
          config.agent.skillCatalogMode.trim()
            ? config.agent.skillCatalogMode.trim()
            : defaultAgentConfig.skillCatalogMode,
        skillL1MaxChars:
          typeof config.agent?.skillL1MaxChars === 'number'
            ? config.agent.skillL1MaxChars
            : defaultAgentConfig.skillL1MaxChars,
        skillBodyMaxChars:
          typeof config.agent?.skillBodyMaxChars === 'number'
            ? config.agent.skillBodyMaxChars
            : defaultAgentConfig.skillBodyMaxChars,
      },
    }
  } catch {
    return defaultConfig
  }
}

export async function saveConfig(config: AppConfig): Promise<void> {
  await invoke('save_config', { config })
}

export async function getTentalDir(): Promise<string> {
  return invoke<string>('get_tental_dir')
}
