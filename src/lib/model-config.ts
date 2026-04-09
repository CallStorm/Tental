import { invoke } from '@tauri-apps/api/core'

export type ProviderType = 'minimax_cn' | 'kimi_cn'

export type ModelProvider = {
  id: string
  providerType: ProviderType
  apiKey: string
  model: string
  baseUrl: string
}

export type ModelConfig = {
  defaultProviderId: string | null
  providers: ModelProvider[]
}

export const PRESETS: Record<
  ProviderType,
  { title: string; baseUrl: string; models: { value: string; label: string }[] }
> = {
  minimax_cn: {
    title: 'MiniMax（中国）',
    baseUrl: 'https://api.minimaxi.com/anthropic',
    models: [
      { value: 'MiniMax-M2.7', label: 'MiniMax M2.7' },
      { value: 'MiniMax-M2.7-highspeed', label: 'MiniMax M2.7 Highspeed' },
    ],
  },
  kimi_cn: {
    title: 'Kimi（中国）',
    baseUrl: 'https://api.moonshot.cn/anthropic',
    models: [{ value: 'kimi-k2.5', label: 'Kimi K2.5' }],
  },
}

export const defaultModelConfig: ModelConfig = {
  defaultProviderId: null,
  providers: [],
}

export async function loadModelConfig(): Promise<ModelConfig> {
  try {
    const raw = await invoke<ModelConfig>('load_model_config')
    return {
      defaultProviderId: raw.defaultProviderId ?? null,
      providers: Array.isArray(raw.providers) ? raw.providers : [],
    }
  } catch {
    return defaultModelConfig
  }
}

export async function saveModelConfig(config: ModelConfig): Promise<void> {
  await invoke('save_model_config', { config })
}

export type TestModelKind = 'connection' | 'multimodal'

export async function testModelEndpoint(payload: {
  providerType: ProviderType
  baseUrl: string
  apiKey: string
  model: string
  testKind: TestModelKind
}): Promise<string> {
  return invoke<string>('test_model_endpoint', {
    req: {
      providerType: payload.providerType,
      baseUrl: payload.baseUrl,
      apiKey: payload.apiKey,
      model: payload.model,
      testKind: payload.testKind,
    },
  })
}
