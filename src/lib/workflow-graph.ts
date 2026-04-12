import type { WorkflowDefinition, WorkflowGraph, WorkflowParamDef } from '@/lib/workflow-api'

export function startParamsOf(wf: WorkflowDefinition): WorkflowParamDef[] {
  const start = wf.graph.nodes.find((n) => n.type === 'start')
  return (start?.data.params as WorkflowParamDef[] | undefined) ?? []
}

/** Linear node ids start→…→end, or null if graph is not a valid single chain. */
export function getLinearNodeIds(graph: WorkflowGraph): string[] | null {
  const nodes = graph.nodes
  const edges = graph.edges
  const starts = nodes.filter((n) => n.type === 'start')
  const ends = nodes.filter((n) => n.type === 'end')
  if (starts.length !== 1 || ends.length !== 1) return null
  const startId = starts[0].id
  const endId = ends[0].id
  const outgoing = new Map<string, string[]>()
  for (const e of edges) {
    if (!outgoing.has(e.source)) outgoing.set(e.source, [])
    outgoing.get(e.source)!.push(e.target)
  }
  for (const [k, tgts] of outgoing) {
    const uniq = [...new Set(tgts)].sort()
    outgoing.set(k, uniq)
  }
  const chain: string[] = []
  let cur = startId
  const seen = new Set<string>()
  while (true) {
    if (seen.has(cur)) return null
    seen.add(cur)
    chain.push(cur)
    if (cur === endId) break
    const nexts = outgoing.get(cur) ?? []
    if (nexts.length !== 1) return null
    cur = nexts[0]
  }
  if (seen.size !== nodes.length) return null
  return chain
}

export function isMiddleStepType(t: string): boolean {
  return t === 'llm' || t === 'code' || t === 'tool' || t === 'toolBuiltin' || t === 'toolMcp'
}

/** Remove a middle node and connect pred→succ. Returns null if delete is not allowed. */
export function deleteMiddleNodeAndRewire(
  graph: WorkflowGraph,
  nodeId: string,
): WorkflowGraph | null {
  const node = graph.nodes.find((n) => n.id === nodeId)
  if (!node) return null
  if (node.type === 'start' || node.type === 'end') return null
  if (!isMiddleStepType(node.type)) return null
  const incoming = graph.edges.filter((e) => e.target === nodeId)
  const outgoing = graph.edges.filter((e) => e.source === nodeId)
  if (incoming.length !== 1 || outgoing.length !== 1) return null
  const pred = incoming[0].source
  const succ = outgoing[0].target
  const newEdgeId = `e-rewire-${pred}-${succ}-${Date.now()}`
  const edges = graph.edges
    .filter((e) => e.target !== nodeId && e.source !== nodeId)
    .concat([{ id: newEdgeId, source: pred, target: succ }])
  const nodes = graph.nodes.filter((n) => n.id !== nodeId)
  return { nodes, edges }
}

export type VariableOption = { label: string; value: string }

/** Paths like start.x and steps.id.field for nodes strictly before `beforeNodeId` in the chain. */
export function buildVariableOptions(
  graph: WorkflowGraph,
  beforeNodeId: string | null,
): VariableOption[] {
  const chain = getLinearNodeIds(graph)
  const out: VariableOption[] = []
  if (!chain) return out
  const start = graph.nodes.find((n) => n.type === 'start')
  const params = (start?.data.params as { name: string }[] | undefined) ?? []
  for (const p of params) {
    out.push({ label: `开始.${p.name}`, value: `start.${p.name}` })
  }
  const idx = beforeNodeId ? chain.indexOf(beforeNodeId) : chain.length
  if (idx <= 0) return out
  for (let i = 1; i < idx; i++) {
    const id = chain[i]
    const n = graph.nodes.find((x) => x.id === id)
    if (!n) continue
    if (n.type === 'llm') {
      out.push({ label: `${id} · LLM 回复`, value: `steps.${id}.text` })
    } else if (n.type === 'code') {
      out.push({ label: `${id} · result`, value: `steps.${id}.result` })
      const keys = (n.data.exportKeys as string[] | undefined) ?? []
      for (const k of keys) {
        if (!k.trim()) continue
        out.push({ label: `${id} · ${k}`, value: `steps.${id}.${k.trim()}` })
      }
    } else if (n.type === 'tool' || n.type === 'toolBuiltin' || n.type === 'toolMcp') {
      out.push({ label: `${id} · 工具输出`, value: `steps.${id}.output` })
    }
  }
  return out
}

export function migrateWorkflowDefinition(wf: WorkflowDefinition): WorkflowDefinition {
  const nodes = wf.graph.nodes.map((n) => {
    if (n.type !== 'tool') return n
    const tr = (n.data.toolRef as string | undefined) ?? ''
    if (!tr) return n
    if (tr.startsWith('mcp__')) {
      const parts = tr.slice('mcp__'.length)
      const i = parts.indexOf('__')
      if (i < 0) return n
      const clientId = parts.slice(0, i)
      const remoteToolName = parts.slice(i + 2)
      return {
        ...n,
        type: 'toolMcp' as const,
        data: {
          ...n.data,
          clientId,
          remoteToolName,
          paramValues: n.data.paramValues ?? {},
        },
      }
    }
    return {
      ...n,
      type: 'toolBuiltin' as const,
      data: {
        ...n.data,
        toolId: tr,
        paramValues: n.data.paramValues ?? {},
      },
    }
  })
  return { ...wf, graph: { ...wf.graph, nodes } }
}

export function decodeMcpToolRef(ref: string): { clientId: string; remoteToolName: string } | null {
  const p = 'mcp__'
  if (!ref.startsWith(p)) return null
  const rest = ref.slice(p.length)
  const i = rest.indexOf('__')
  if (i < 0) return null
  const clientId = rest.slice(0, i)
  const remoteToolName = rest.slice(i + 2)
  if (!clientId || !remoteToolName) return null
  return { clientId, remoteToolName }
}
