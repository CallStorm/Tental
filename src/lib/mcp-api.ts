import { invoke } from '@tauri-apps/api/core'

export type McpHeader = {
  key: string
  value: string
}

export type McpClientConfig = {
  id: string
  name: string
  transport: 'streamable_http' | string
  url: string
  headers: McpHeader[]
  bearerToken: string
  enabled: boolean
  createdAt: number
  updatedAt: number
}

export type McpConnectionTestResult = {
  ok: boolean
  message: string
}

export type McpToolMeta = {
  name: string
  description: string
}

export async function listMcpClients(): Promise<McpClientConfig[]> {
  const res = await invoke<McpClientConfig[]>('list_mcp_clients')
  return Array.isArray(res) ? res : []
}

export async function saveMcpClient(payload: {
  id?: string | null
  name: string
  url: string
  headers: McpHeader[]
  bearerToken: string
  enabled: boolean
}): Promise<McpClientConfig> {
  return invoke<McpClientConfig>('save_mcp_client', {
    req: {
      id: payload.id ?? null,
      name: payload.name,
      url: payload.url,
      headers: payload.headers,
      bearerToken: payload.bearerToken,
      enabled: payload.enabled,
    },
  })
}

export async function deleteMcpClient(id: string): Promise<void> {
  await invoke('delete_mcp_client', { req: { id } })
}

export async function setMcpClientEnabled(id: string, enabled: boolean): Promise<void> {
  await invoke('set_mcp_client_enabled', { req: { id, enabled } })
}

export async function testMcpClient(id: string): Promise<McpConnectionTestResult> {
  return invoke<McpConnectionTestResult>('test_mcp_client', { req: { id } })
}

export async function listMcpClientTools(id: string): Promise<McpToolMeta[]> {
  const res = await invoke<McpToolMeta[]>('list_mcp_client_tools', { req: { id } })
  return Array.isArray(res) ? res : []
}
