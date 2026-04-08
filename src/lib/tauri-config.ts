import { invoke } from '@tauri-apps/api/core'

export type AppConfig = {
  theme: 'light' | 'dark' | 'system'
  language: 'zh' | 'en'
  agent: AgentConfig
}

export type AgentConfig = {
  language: 'zh' | 'en'
  maxIterations: number
  maxContextTokens: number
  autoRetryEnabled: boolean
  maxRetryCount: number
}

export const defaultAgentConfig: AgentConfig = {
  language: 'zh',
  maxIterations: 6,
  maxContextTokens: 12000,
  autoRetryEnabled: true,
  maxRetryCount: 2,
}

export const defaultConfig: AppConfig = {
  theme: 'system',
  language: 'zh',
  agent: defaultAgentConfig,
}

export async function loadConfig(): Promise<AppConfig> {
  try {
    const config = await invoke<AppConfig>('load_config')
    return {
      theme: config.theme ?? defaultConfig.theme,
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
