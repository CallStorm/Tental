import { invoke } from '@tauri-apps/api/core'

export type AppConfig = {
  theme: 'light' | 'dark' | 'system'
  language: 'zh' | 'en'
}

export const defaultConfig: AppConfig = {
  theme: 'system',
  language: 'zh',
}

export async function loadConfig(): Promise<AppConfig> {
  try {
    const config = await invoke<AppConfig>('load_config')
    return {
      theme: config.theme ?? defaultConfig.theme,
      language: config.language ?? defaultConfig.language,
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
