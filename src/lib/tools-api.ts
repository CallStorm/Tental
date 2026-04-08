import { invoke } from '@tauri-apps/api/core'

export type ToolMeta = {
  id: string
  name: string
  description: string
  risk: 'safe' | 'danger' | string
  enabled: boolean
}

export type ToolSecurityConfig = {
  allowedRoots: string[]
  commandAllowlist: string[]
  commandBlacklist: string[]
  maxFileBytes: number
  maxReadLines: number
  rejectBinary: boolean
}

export async function listTools(): Promise<ToolMeta[]> {
  const res = await invoke<ToolMeta[]>('list_tools')
  return Array.isArray(res) ? res : []
}

export async function setToolEnabled(toolId: string, enabled: boolean): Promise<void> {
  await invoke('set_tool_enabled', { req: { toolId, enabled } })
}

export async function loadToolSecurity(): Promise<ToolSecurityConfig> {
  return invoke<ToolSecurityConfig>('load_tool_security')
}

export async function saveToolSecurity(config: ToolSecurityConfig): Promise<void> {
  await invoke('save_tool_security', { config })
}

export async function loadBlacklist(): Promise<string[]> {
  const res = await invoke<string[]>('load_blacklist')
  return Array.isArray(res) ? res : []
}

export async function saveBlacklist(list: string[]): Promise<void> {
  await invoke('save_blacklist', { list })
}

export async function runTool(payload: {
  name: string
  input: unknown
}): Promise<{
  ok: boolean
  name: string
  output: unknown
  error?: string | null
  errorCode?: string | null
}> {
  return invoke('run_tool', { req: payload })
}

