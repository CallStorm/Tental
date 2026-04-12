import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { MutableRefObject } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  addEdge,
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { ArrowLeft, Loader2, Play, Plus, Save, Workflow as WorkflowIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ToolSchemaFields } from '@/components/workflow/tool-schema-fields'
import { VariablePicker } from '@/components/workflow/variable-picker'
import { cn } from '@/lib/utils'
import { listMcpClients, listMcpClientTools, type McpClientConfig, type McpToolMeta } from '@/lib/mcp-api'
import { loadModelConfig, type ModelProvider } from '@/lib/model-config'
import { listTools, type ToolMeta } from '@/lib/tools-api'
import {
  getBuiltinToolInputSchema,
  loadWorkflowStore,
  nowMs,
  saveWorkflowStore,
  type WorkflowDefinition,
  type WorkflowEdge,
  type WorkflowGraph,
  type WorkflowNode,
  type WorkflowNodeType,
  type WorkflowStoreData,
} from '@/lib/workflow-api'
import {
  buildVariableOptions,
  deleteMiddleNodeAndRewire,
  migrateWorkflowDefinition,
} from '@/lib/workflow-graph'

function nodeLabel(n: WorkflowNode): string {
  switch (n.type) {
    case 'start':
      return '开始'
    case 'llm':
      return 'LLM'
    case 'code':
      return '代码'
    case 'tool':
    case 'toolBuiltin':
      return '内置工具'
    case 'toolMcp':
      return 'MCP 工具'
    case 'end':
      return '结束'
    default:
      return String(n.type)
  }
}

function mapNodeType(t: WorkflowNodeType): string {
  switch (t) {
    case 'start':
      return 'wfStart'
    case 'llm':
      return 'wfLlm'
    case 'code':
      return 'wfCode'
    case 'tool':
    case 'toolBuiltin':
      return 'wfToolBuiltin'
    case 'toolMcp':
      return 'wfToolMcp'
    case 'end':
      return 'wfEnd'
    default:
      return 'wfLlm'
  }
}

function graphToFlow(graph: WorkflowGraph): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = graph.nodes.map((n) => ({
    id: n.id,
    type: mapNodeType(n.type),
    position: n.position,
    data: { wf: n },
  }))
  const edges: Edge[] = graph.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
  }))
  return { nodes, edges }
}

function flowToGraph(nodes: Node[], edges: Edge[]): WorkflowGraph {
  const wfNodes: WorkflowNode[] = nodes.map((n) => {
    const wf = (n.data as { wf: WorkflowNode }).wf
    return { ...wf, position: n.position }
  })
  const wfEdges: WorkflowEdge[] = edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
  }))
  return { nodes: wfNodes, edges: wfEdges }
}

function WfShell({
  title,
  children,
  target,
  source,
}: {
  title: string
  children?: React.ReactNode
  target?: boolean
  source?: boolean
}) {
  return (
    <div
      className={cn(
        'min-w-[140px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-left shadow-sm',
        'dark:border-slate-700 dark:bg-slate-900',
      )}
    >
      {target ? (
        <Handle type="target" position={Position.Left} className="!h-2.5 !w-2.5 !bg-slate-500" />
      ) : null}
      <div className="text-xs font-semibold text-slate-800 dark:text-slate-100">{title}</div>
      {children}
      {source ? (
        <Handle type="source" position={Position.Right} className="!h-2.5 !w-2.5 !bg-slate-500" />
      ) : null}
    </div>
  )
}

function WfStartNode(props: NodeProps) {
  const wf = (props.data as { wf: WorkflowNode }).wf
  const params = (wf.data.params as { name: string }[] | undefined) ?? []
  return (
    <WfShell title="开始" source>
      <div className="mt-1 text-[10px] text-slate-500">
        {params.length ? `${params.length} 个参数` : '未定义参数'}
      </div>
    </WfShell>
  )
}

function WfLlmNode({}: NodeProps) {
  return (
    <WfShell title="LLM" target source>
      <div className="mt-1 text-[10px] text-slate-500">模型 + 提示词</div>
    </WfShell>
  )
}

function WfCodeNode({}: NodeProps) {
  return (
    <WfShell title="Python" target source>
      <div className="mt-1 text-[10px] text-slate-500">result / 导出</div>
    </WfShell>
  )
}

function WfToolBuiltinNode({}: NodeProps) {
  return (
    <WfShell title="内置工具" target source>
      <div className="mt-1 text-[10px] text-slate-500">Tental 工具</div>
    </WfShell>
  )
}

function WfToolMcpNode({}: NodeProps) {
  return (
    <WfShell title="MCP" target source>
      <div className="mt-1 text-[10px] text-slate-500">远程工具</div>
    </WfShell>
  )
}

function WfEndNode({}: NodeProps) {
  return (
    <WfShell title="结束" target>
      <div className="mt-1 text-[10px] text-slate-500">输出模板</div>
    </WfShell>
  )
}

const nodeTypes = {
  wfStart: WfStartNode,
  wfLlm: WfLlmNode,
  wfCode: WfCodeNode,
  wfToolBuiltin: WfToolBuiltinNode,
  wfToolMcp: WfToolMcpNode,
  wfEnd: WfEndNode,
}

function insertStepBeforeEnd(
  graph: WorkflowGraph,
  kind: 'llm' | 'code' | 'toolBuiltin' | 'toolMcp',
): WorkflowGraph {
  const endNode = graph.nodes.find((n) => n.type === 'end')
  if (!endNode) return graph
  const incoming = graph.edges.filter((e) => e.target === endNode.id)
  if (incoming.length !== 1) return graph
  const predId = incoming[0].source
  const newId = `n-${crypto.randomUUID().slice(0, 8)}`
  const y = endNode.position.y
  const x = (graph.nodes.find((n) => n.id === predId)?.position.x ?? 200) + 220
  let node: WorkflowNode
  if (kind === 'llm') {
    node = {
      id: newId,
      type: 'llm',
      position: { x, y },
      data: { providerId: null, systemPrompt: '', userPrompt: '{{start.topic}}' },
    }
  } else if (kind === 'code') {
    node = {
      id: newId,
      type: 'code',
      position: { x, y },
      data: { source: 'result = {"ok": True}\n', timeoutMs: 60_000, exportKeys: [] },
    }
  } else if (kind === 'toolBuiltin') {
    node = {
      id: newId,
      type: 'toolBuiltin',
      position: { x, y },
      data: { toolId: 'get_current_time', paramValues: {}, inputJson: '{}' },
    }
  } else {
    node = {
      id: newId,
      type: 'toolMcp',
      position: { x, y },
      data: { clientId: '', remoteToolName: '', paramValues: {}, inputJson: '{}' },
    }
  }
  const edges = graph.edges
    .filter((e) => !(e.source === predId && e.target === endNode.id))
    .concat([
      { id: `e-${newId}-a`, source: predId, target: newId },
      { id: `e-${newId}-b`, source: newId, target: endNode.id },
    ])
  return { nodes: [...graph.nodes, node], edges }
}

export type WorkflowEditorHandle = { flushGraph: () => WorkflowGraph }

const WorkflowEditorInner = forwardRef<
  WorkflowEditorHandle,
  {
    draft: WorkflowDefinition
    onDraftChange: (next: WorkflowDefinition) => void
    providers: ModelProvider[]
    tools: ToolMeta[]
    mcpClients: McpClientConfig[]
    mcpToolsByClient: Record<string, McpToolMeta[]>
    builtinSchemaCache: MutableRefObject<Record<string, unknown>>
  }
>(function WorkflowEditorInner(
  { draft, onDraftChange, providers, tools, mcpClients, mcpToolsByClient, builtinSchemaCache },
  ref,
) {
  const { getNodes, getEdges } = useReactFlow()
  const g0 = graphToFlow(draft.graph)
  const [nodes, setNodes, onNodesChange] = useNodesState(g0.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(g0.edges)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null)

  const persistGraphFromFlow = useCallback((): WorkflowGraph => {
    const g = flowToGraph(getNodes(), getEdges())
    onDraftChange({ ...draft, graph: g, updatedAt: nowMs() })
    return g
  }, [draft, getNodes, getEdges, onDraftChange])

  useImperativeHandle(ref, () => ({ flushGraph: persistGraphFromFlow }), [persistGraphFromFlow])

  useEffect(() => {
    const g = graphToFlow(draft.graph)
    setNodes(g.nodes)
    setEdges(g.edges)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.id, setEdges, setNodes])

  const onConnect = useCallback(
    (c: Connection) => {
      setEdges((eds) => addEdge({ ...c, markerEnd: { type: MarkerType.ArrowClosed } }, eds))
      window.setTimeout(() => persistGraphFromFlow(), 0)
    },
    [setEdges, persistGraphFromFlow],
  )

  const selected = useMemo(() => {
    if (!selectedId) return null
    return draft.graph.nodes.find((n) => n.id === selectedId) ?? null
  }, [draft.graph.nodes, selectedId])

  const variableOptions = useMemo(() => {
    if (!selected) return []
    return buildVariableOptions(draft.graph, selected.id)
  }, [draft.graph, selected])

  const updateSelectedData = (patch: Record<string, unknown>) => {
    if (!selected) return
    const nextNodes = draft.graph.nodes.map((n) =>
      n.id === selected.id ? { ...n, data: { ...n.data, ...patch } } : n,
    )
    onDraftChange({ ...draft, graph: { ...draft.graph, nodes: nextNodes }, updatedAt: nowMs() })
    setNodes((nds) =>
      nds.map((node) => {
        if (node.id !== selected.id) return node
        const wf = (node.data as { wf: WorkflowNode }).wf
        return { ...node, data: { wf: { ...wf, data: { ...wf.data, ...patch } } } }
      }),
    )
  }

  const addParam = () => {
    if (!selected || selected.type !== 'start') return
    const raw = selected.data.params
    const params = (Array.isArray(raw) ? [...raw] : []) as { name: string; type: string; required: boolean }[]
    params.push({ name: `p${params.length + 1}`, type: 'string', required: false })
    updateSelectedData({ params })
  }

  const deleteFromMenu = () => {
    if (!menu) return
    const next = deleteMiddleNodeAndRewire(draft.graph, menu.nodeId)
    setMenu(null)
    if (!next) {
      window.alert('无法删除：请确保节点在单链中间且仅有一条入边和一条出边。')
      return
    }
    onDraftChange({ ...draft, graph: next, updatedAt: nowMs() })
    if (selectedId === menu.nodeId) setSelectedId(null)
  }

  const [builtinSchema, setBuiltinSchema] = useState<unknown>(null)

  useEffect(() => {
    if (selected?.type !== 'toolBuiltin') {
      setBuiltinSchema(null)
      return
    }
    const tid = (selected.data.toolId as string) || 'get_current_time'
    const cached = builtinSchemaCache.current[tid]
    if (cached) {
      setBuiltinSchema(cached)
      return
    }
    void (async () => {
      try {
        const s = await getBuiltinToolInputSchema(tid)
        builtinSchemaCache.current[tid] = s
        setBuiltinSchema(s)
      } catch {
        setBuiltinSchema({ type: 'object', properties: {} })
      }
    })()
  }, [selected, builtinSchemaCache])

  const paramValuesForSelected = useMemo(() => {
    if (!selected) return {}
    const pv = selected.data.paramValues
    if (pv && typeof pv === 'object' && !Array.isArray(pv)) return pv as Record<string, string>
    return {}
  }, [selected])

  const setParamValues = (next: Record<string, string>) => {
    updateSelectedData({ paramValues: next })
  }

  const mcpSchemaForSelected = useMemo(() => {
    if (selected?.type !== 'toolMcp') return null
    const cid = selected.data.clientId as string
    const name = selected.data.remoteToolName as string
    const list = mcpToolsByClient[cid] ?? []
    const meta = list.find((t) => t.name === name)
    return meta?.inputSchema ?? null
  }, [selected, mcpToolsByClient])

  return (
    <div className="flex min-h-[560px] flex-1 gap-3">
      <div className="relative min-h-[480px] flex-1 rounded-lg border border-slate-200 dark:border-slate-800">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onNodeDragStop={() => persistGraphFromFlow()}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={(_, n) => {
            setSelectedId(n.id)
            setMenu(null)
          }}
          onNodeContextMenu={(e, n) => {
            e.preventDefault()
            const wf = (n.data as { wf: WorkflowNode }).wf
            if (wf.type === 'start' || wf.type === 'end') return
            setMenu({ x: e.clientX, y: e.clientY, nodeId: n.id })
          }}
          onPaneClick={() => setMenu(null)}
          fitView
        >
          <Background />
          <MiniMap />
          <Controls />
        </ReactFlow>
        {menu ? (
          <div
            className="fixed z-[100] rounded-md border border-slate-200 bg-white py-1 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-900"
            style={{ left: menu.x, top: menu.y }}
          >
            <button
              type="button"
              className="block w-full px-4 py-2 text-left text-red-600 hover:bg-slate-100 dark:hover:bg-slate-800"
              onClick={() => deleteFromMenu()}
            >
              删除节点
            </button>
          </div>
        ) : null}
      </div>
      <div className="w-[340px] shrink-0 space-y-3 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950">
        <div>
          <div className="text-xs font-medium text-slate-500">节点属性</div>
          {!selected ? (
            <p className="mt-2 text-sm text-slate-500">点击画布上的节点</p>
          ) : (
            <div className="mt-2 space-y-2 text-sm">
              <div className="font-medium text-slate-800 dark:text-slate-100">
                {nodeLabel(selected)} <span className="text-slate-400">({selected.id})</span>
              </div>
              {selected.type === 'start' ? (
                <div className="space-y-2">
                  <Button type="button" variant="outline" size="sm" className="w-full" onClick={addParam}>
                    <Plus className="mr-1 h-3 w-3" />
                    添加参数
                  </Button>
                  {((selected.data.params as { name: string; type?: string; required?: boolean }[]) ?? []).map(
                    (p, idx) => (
                      <div key={idx} className="flex flex-col gap-1 rounded border border-slate-100 p-2 dark:border-slate-800">
                        <input
                          className="w-full rounded border border-slate-200 px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900"
                          value={p.name}
                          onChange={(e) => {
                            const params = [
                              ...(((selected.data.params as object[]) ?? []) as {
                                name: string
                                type?: string
                                required?: boolean
                              }[]),
                            ]
                            params[idx] = { ...params[idx], name: e.target.value }
                            updateSelectedData({ params })
                          }}
                        />
                        <label className="flex items-center gap-2 text-xs text-slate-600">
                          <input
                            type="checkbox"
                            checked={!!p.required}
                            onChange={(ev) => {
                              const params = [
                                ...(((selected.data.params as object[]) ?? []) as {
                                  name: string
                                  type?: string
                                  required?: boolean
                                }[]),
                              ]
                              params[idx] = { ...params[idx], required: ev.target.checked }
                              updateSelectedData({ params })
                            }}
                          />
                          必填
                        </label>
                      </div>
                    ),
                  )}
                </div>
              ) : null}
              {selected.type === 'llm' ? (
                <div className="space-y-2">
                  <label className="block text-xs text-slate-500">模型供应商</label>
                  <select
                    className="w-full rounded border border-slate-200 px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900"
                    value={(selected.data.providerId as string | null | undefined) ?? ''}
                    onChange={(e) =>
                      updateSelectedData({ providerId: e.target.value === '' ? null : e.target.value })
                    }
                  >
                    <option value="">默认</option>
                    {providers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.model}
                      </option>
                    ))}
                  </select>
                  <div className="flex items-center justify-between gap-2">
                    <label className="block text-xs text-slate-500">系统提示</label>
                    <VariablePicker options={variableOptions} onInsert={(w) => updateSelectedData({ systemPrompt: ((selected.data.systemPrompt as string) ?? '') + w })} />
                  </div>
                  <textarea
                    className="h-16 w-full rounded border border-slate-200 px-2 py-1 font-mono text-xs dark:border-slate-700 dark:bg-slate-900"
                    value={(selected.data.systemPrompt as string) ?? ''}
                    onChange={(e) => updateSelectedData({ systemPrompt: e.target.value })}
                  />
                  <div className="flex items-center justify-between gap-2">
                    <label className="block text-xs text-slate-500">用户提示</label>
                    <VariablePicker options={variableOptions} onInsert={(w) => updateSelectedData({ userPrompt: ((selected.data.userPrompt as string) ?? '') + w })} />
                  </div>
                  <textarea
                    className="h-24 w-full rounded border border-slate-200 px-2 py-1 font-mono text-xs dark:border-slate-700 dark:bg-slate-900"
                    value={(selected.data.userPrompt as string) ?? ''}
                    onChange={(e) => updateSelectedData({ userPrompt: e.target.value })}
                  />
                </div>
              ) : null}
              {selected.type === 'code' ? (
                <div className="space-y-2">
                  <label className="block text-xs text-slate-500">导出字段名（result 为对象时的键，逗号分隔）</label>
                  <input
                    className="w-full rounded border border-slate-200 px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900"
                    value={((selected.data.exportKeys as string[] | undefined) ?? []).join(', ')}
                    onChange={(e) =>
                      updateSelectedData({
                        exportKeys: e.target.value
                          .split(',')
                          .map((s) => s.trim())
                          .filter(Boolean),
                      })
                    }
                  />
                  <label className="block text-xs text-slate-500">Python（设置 result）</label>
                  <textarea
                    className="h-36 w-full rounded border border-slate-200 px-2 py-1 font-mono text-[11px] dark:border-slate-700 dark:bg-slate-900"
                    value={(selected.data.source as string) ?? ''}
                    onChange={(e) => updateSelectedData({ source: e.target.value })}
                  />
                  <label className="block text-xs text-slate-500">超时 (ms)</label>
                  <input
                    type="number"
                    className="w-full rounded border border-slate-200 px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900"
                    value={(selected.data.timeoutMs as number) ?? 60000}
                    onChange={(e) => updateSelectedData({ timeoutMs: Number(e.target.value) || 60000 })}
                  />
                </div>
              ) : null}
              {selected.type === 'toolBuiltin' ? (
                <div className="space-y-2">
                  <label className="block text-xs text-slate-500">工具</label>
                  <select
                    className="w-full rounded border border-slate-200 px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900"
                    value={(selected.data.toolId as string) ?? ''}
                    onChange={(e) => updateSelectedData({ toolId: e.target.value, paramValues: {} })}
                  >
                    {tools.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                  <ToolSchemaFields
                    schema={builtinSchema}
                    values={paramValuesForSelected}
                    onChange={setParamValues}
                    variableOptions={variableOptions}
                  />
                  <details className="text-xs">
                    <summary className="cursor-pointer text-slate-500">原始 JSON 模板（高级）</summary>
                    <textarea
                      className="mt-1 h-16 w-full rounded border border-slate-200 px-2 py-1 font-mono dark:border-slate-700 dark:bg-slate-900"
                      value={(selected.data.inputJson as string) ?? '{}'}
                      onChange={(e) => updateSelectedData({ inputJson: e.target.value })}
                    />
                  </details>
                </div>
              ) : null}
              {selected.type === 'toolMcp' ? (
                <div className="space-y-2">
                  <label className="block text-xs text-slate-500">MCP 客户端</label>
                  <select
                    className="w-full rounded border border-slate-200 px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900"
                    value={(selected.data.clientId as string) ?? ''}
                    onChange={(e) =>
                      updateSelectedData({ clientId: e.target.value, remoteToolName: '', paramValues: {} })
                    }
                  >
                    <option value="">选择…</option>
                    {mcpClients
                      .filter((c) => c.enabled)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </select>
                  <label className="block text-xs text-slate-500">工具</label>
                  <select
                    className="w-full rounded border border-slate-200 px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900"
                    value={(selected.data.remoteToolName as string) ?? ''}
                    onChange={(e) => updateSelectedData({ remoteToolName: e.target.value, paramValues: {} })}
                  >
                    <option value="">选择…</option>
                    {(mcpToolsByClient[selected.data.clientId as string] ?? []).map((mt) => (
                      <option key={mt.name} value={mt.name}>
                        {mt.name}
                      </option>
                    ))}
                  </select>
                  <ToolSchemaFields
                    schema={mcpSchemaForSelected}
                    values={paramValuesForSelected}
                    onChange={setParamValues}
                    variableOptions={variableOptions}
                  />
                  <details className="text-xs">
                    <summary className="cursor-pointer text-slate-500">原始 JSON 模板（高级）</summary>
                    <textarea
                      className="mt-1 h-16 w-full rounded border border-slate-200 px-2 py-1 font-mono dark:border-slate-700 dark:bg-slate-900"
                      value={(selected.data.inputJson as string) ?? '{}'}
                      onChange={(e) => updateSelectedData({ inputJson: e.target.value })}
                    />
                  </details>
                </div>
              ) : null}
              {selected.type === 'end' ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <label className="block text-xs text-slate-500">输出模板</label>
                    <VariablePicker options={variableOptions} onInsert={(w) => updateSelectedData({ outputTemplate: ((selected.data.outputTemplate as string) ?? '') + w })} />
                  </div>
                  <textarea
                    className="h-28 w-full rounded border border-slate-200 px-2 py-1 font-mono text-xs dark:border-slate-700 dark:bg-slate-900"
                    value={(selected.data.outputTemplate as string) ?? ''}
                    onChange={(e) => updateSelectedData({ outputTemplate: e.target.value })}
                  />
                </div>
              ) : null}
            </div>
          )}
        </div>
        <div className="border-t border-slate-100 pt-3 dark:border-slate-800">
          <div className="text-xs font-medium text-slate-500">插入步骤</div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                const g = insertStepBeforeEnd(draft.graph, 'llm')
                onDraftChange({ ...draft, graph: g, updatedAt: nowMs() })
              }}
            >
              + LLM
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                const g = insertStepBeforeEnd(draft.graph, 'code')
                onDraftChange({ ...draft, graph: g, updatedAt: nowMs() })
              }}
            >
              + 代码
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                const g = insertStepBeforeEnd(draft.graph, 'toolBuiltin')
                onDraftChange({ ...draft, graph: g, updatedAt: nowMs() })
              }}
            >
              + 内置工具
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                const g = insertStepBeforeEnd(draft.graph, 'toolMcp')
                onDraftChange({ ...draft, graph: g, updatedAt: nowMs() })
              }}
            >
              + MCP
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
})

export function WorkflowEditorPage() {
  const { id } = useParams<{ id: string }>()
  const [store, setStore] = useState<WorkflowStoreData | null>(null)
  const [draft, setDraft] = useState<WorkflowDefinition | null>(null)
  const [hint, setHint] = useState<string | null>(null)
  const [nameEdit, setNameEdit] = useState('')
  const [providers, setProviders] = useState<ModelProvider[]>([])
  const [tools, setTools] = useState<ToolMeta[]>([])
  const [mcpClients, setMcpClients] = useState<McpClientConfig[]>([])
  const [mcpToolsByClient, setMcpToolsByClient] = useState<Record<string, McpToolMeta[]>>({})
  const editorRef = useRef<WorkflowEditorHandle>(null)
  const builtinSchemaCache = useRef<Record<string, unknown>>({})

  const reload = useCallback(async () => {
    const s = await loadWorkflowStore()
    setStore(s)
    return s
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    void (async () => {
      const [mc, t, mcs] = await Promise.all([loadModelConfig(), listTools(), listMcpClients()])
      setProviders(mc.providers ?? [])
      setTools(t)
      setMcpClients(mcs)
      const map: Record<string, McpToolMeta[]> = {}
      for (const c of mcs.filter((x) => x.enabled)) {
        try {
          map[c.id] = await listMcpClientTools(c.id)
        } catch {
          map[c.id] = []
        }
      }
      setMcpToolsByClient(map)
    })()
  }, [])

  useEffect(() => {
    if (!store || !id) {
      setDraft(null)
      return
    }
    const w = store.workflows.find((x) => x.id === id)
    if (!w) {
      setDraft(null)
      return
    }
    const m = migrateWorkflowDefinition(structuredClone(w))
    setDraft(m)
    setNameEdit(m.name)
  }, [store, id])

  const persistFull = useCallback(async (next: WorkflowStoreData) => {
    setStore(next)
    await saveWorkflowStore(next)
  }, [])

  const saveDraftToStore = useCallback(async () => {
    if (!store || !draft || !id) return
    const graph = editorRef.current?.flushGraph() ?? draft.graph
    const snapshot = { ...draft, name: nameEdit.trim() || draft.name, graph, updatedAt: nowMs() }
    const others = store.workflows.filter((w) => w.id !== draft.id)
    await persistFull({ ...store, workflows: [snapshot, ...others] })
    setDraft(snapshot)
    setHint('已保存')
  }, [store, draft, id, nameEdit, persistFull])

  if (!id) {
    return null
  }

  if (store && !store.workflows.some((w) => w.id === id)) {
    return (
      <div className="p-6">
        <p className="text-slate-600">找不到该工作流。</p>
        <Button type="button" variant="outline" className="mt-4" asChild>
          <Link to="/workflow">返回列表</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" size="sm" asChild>
          <Link to="/workflow">
            <ArrowLeft className="mr-1 h-4 w-4" />
            列表
          </Link>
        </Button>
        <WorkflowIcon className="h-5 w-5 text-slate-600" />
        <input
          className="min-w-[12rem] rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm font-medium dark:border-slate-700 dark:bg-slate-900"
          value={nameEdit}
          onChange={(e) => setNameEdit(e.target.value)}
        />
        <Button type="button" variant="outline" size="sm" onClick={() => void saveDraftToStore()} disabled={!draft}>
          <Save className="mr-1 h-4 w-4" />
          保存
        </Button>
        <Button type="button" size="sm" variant="outline" asChild>
          <Link to="/workflow">
            <Play className="mr-1 h-4 w-4" />
            在列表中运行
          </Link>
        </Button>
      </div>
      {hint ? <div className="text-sm text-slate-600 dark:text-slate-300">{hint}</div> : null}

      {draft ? (
        <div className="flex min-h-[560px] flex-1 flex-col">
          <ReactFlowProvider
            key={`${draft.id}-${draft.graph.nodes.length}-${draft.graph.edges.map((e) => e.id).join(',')}`}
          >
            <WorkflowEditorInner
              ref={editorRef}
              draft={draft}
              onDraftChange={(d) => setDraft(d)}
              providers={providers}
              tools={tools}
              mcpClients={mcpClients}
              mcpToolsByClient={mcpToolsByClient}
              builtinSchemaCache={builtinSchemaCache}
            />
          </ReactFlowProvider>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          加载中…
        </div>
      )}
    </div>
  )
}
