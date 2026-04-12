import { invoke } from '@tauri-apps/api/core'

export type NodePosition = { x: number; y: number }

export type WorkflowParamDef = {
  name: string
  /** `string` | `number` | `boolean` | `json` */
  type?: string
  required?: boolean
  default?: string
}

export type WorkflowNodeType =
  | 'start'
  | 'llm'
  | 'code'
  | 'tool'
  | 'toolBuiltin'
  | 'toolMcp'
  | 'end'

export type WorkflowNode = {
  id: string
  type: WorkflowNodeType
  position: NodePosition
  /** Type-specific payload */
  data: Record<string, unknown>
}

export type WorkflowEdge = {
  id: string
  source: string
  target: string
}

export type WorkflowGraph = {
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
}

export type WorkflowDefinition = {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  graph: WorkflowGraph
}

export type WorkflowStepLog = {
  nodeId: string
  /** 节点类型，如 llm / code / tool / end */
  type: string
  startedAt: number
  finishedAt: number
  ok: boolean
  detail?: string
  outputPreview?: string
}

export type WorkflowRun = {
  id: string
  workflowId: string
  workflowNameSnapshot: string
  startedAt: number
  finishedAt: number
  status: string
  input: unknown
  outputs: unknown
  stepLogs: WorkflowStepLog[]
  error?: string
}

export type WorkflowStoreData = {
  workflows: WorkflowDefinition[]
  runs: WorkflowRun[]
}

export async function loadWorkflowStore(): Promise<WorkflowStoreData> {
  const raw = await invoke<WorkflowStoreData>('load_workflow_store')
  return {
    workflows: Array.isArray(raw.workflows) ? raw.workflows : [],
    runs: Array.isArray(raw.runs) ? raw.runs : [],
  }
}

export async function saveWorkflowStore(store: WorkflowStoreData): Promise<void> {
  await invoke('save_workflow_store', { store })
}

export async function executeWorkflow(
  workflowId: string,
  startInputs: Record<string, unknown>,
): Promise<WorkflowRun> {
  return invoke<WorkflowRun>('execute_workflow', {
    req: { workflowId, startInputs },
  })
}

export async function getBuiltinToolInputSchema(toolId: string): Promise<unknown> {
  return invoke<unknown>('get_builtin_tool_input_schema', {
    req: { toolId },
  })
}

export function newWorkflowId(): string {
  return crypto.randomUUID()
}

export function nowMs(): number {
  return Date.now()
}

/** Match Rust `mcp::encode_chat_mcp_tool_name`. */
export function encodeMcpToolRef(clientId: string, remoteToolName: string): string {
  const c = clientId.trim().replace(/__/g, '_')
  const r = remoteToolName.trim().replace(/__/g, '_')
  return `mcp__${c}__${r}`
}

export function emptyWorkflow(name: string): WorkflowDefinition {
  const id = newWorkflowId()
  const t = nowMs()
  const ns = `n-${id.slice(0, 8)}`
  const startId = `${ns}-start`
  const llmId = `${ns}-llm`
  const endId = `${ns}-end`
  return {
    id,
    name,
    createdAt: t,
    updatedAt: t,
    graph: {
      nodes: [
        {
          id: startId,
          type: 'start',
          position: { x: 40, y: 120 },
          data: {
            params: [{ name: 'topic', type: 'string', required: true }],
          },
        },
        {
          id: llmId,
          type: 'llm',
          position: { x: 320, y: 120 },
          data: {
            providerId: null,
            systemPrompt: '',
            userPrompt: '请用一句话概括主题：{{start.topic}}',
          },
        },
        {
          id: endId,
          type: 'end',
          position: { x: 600, y: 120 },
          data: {
            outputTemplate: `{{steps.${llmId}.text}}`,
          },
        },
      ],
      edges: [
        { id: `e-${ns}-1`, source: startId, target: llmId },
        { id: `e-${ns}-2`, source: llmId, target: endId },
      ],
    },
  }
}
