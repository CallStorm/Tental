import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  deleteMcpClient,
  listMcpClientTools,
  listMcpClients,
  saveMcpClient,
  setMcpClientEnabled,
  testMcpClient,
  type McpClientConfig,
  type McpHeader,
  type McpToolMeta,
} from '@/lib/mcp-api'

type FormState = {
  id?: string
  name: string
  url: string
  bearerToken: string
  enabled: boolean
  headers: McpHeader[]
}

const emptyForm: FormState = {
  name: '',
  url: '',
  bearerToken: '',
  enabled: true,
  headers: [{ key: '', value: '' }],
}

export function McpPage() {
  const [clients, setClients] = useState<McpClientConfig[]>([])
  const [busy, setBusy] = useState(false)
  const [hint, setHint] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [toolsByClient, setToolsByClient] = useState<Record<string, McpToolMeta[]>>({})
  const [testingId, setTestingId] = useState<string | null>(null)
  const [toolLoadingId, setToolLoadingId] = useState<string | null>(null)

  const enabledCount = useMemo(
    () => clients.filter((x) => x.enabled).length,
    [clients],
  )

  const loadAll = async () => {
    setHint(null)
    const list = await listMcpClients()
    setClients(list)
  }

  useEffect(() => {
    void loadAll()
  }, [])

  const openCreate = () => {
    setForm(emptyForm)
    setFormOpen(true)
    setHint(null)
  }

  const openEdit = (item: McpClientConfig) => {
    setForm({
      id: item.id,
      name: item.name,
      url: item.url,
      bearerToken: item.bearerToken ?? '',
      enabled: item.enabled,
      headers: item.headers.length > 0 ? item.headers : [{ key: '', value: '' }],
    })
    setFormOpen(true)
    setHint(null)
  }

  const closeForm = () => {
    setFormOpen(false)
    setForm(emptyForm)
  }

  const saveClient = async () => {
    setHint(null)
    const url = form.url.trim()
    if (!form.name.trim()) {
      setHint('名称不能为空')
      return
    }
    if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
      setHint('URL 必须以 http:// 或 https:// 开头')
      return
    }
    setBusy(true)
    try {
      await saveMcpClient({
        id: form.id ?? null,
        name: form.name.trim(),
        url,
        bearerToken: form.bearerToken,
        enabled: form.enabled,
        headers: form.headers,
      })
      await loadAll()
      closeForm()
      setHint('已保存')
    } catch (e) {
      setHint(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const toggleEnabled = async (id: string, enabled: boolean) => {
    setBusy(true)
    setHint(null)
    try {
      await setMcpClientEnabled(id, enabled)
      setClients((list) => list.map((x) => (x.id === id ? { ...x, enabled } : x)))
    } catch (e) {
      setHint(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const removeClient = async (id: string) => {
    const ok = window.confirm('确定删除该 MCP 客户端吗？')
    if (!ok) return
    setBusy(true)
    setHint(null)
    try {
      await deleteMcpClient(id)
      setClients((list) => list.filter((x) => x.id !== id))
      setToolsByClient((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
    } catch (e) {
      setHint(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const testConnection = async (id: string) => {
    setTestingId(id)
    setHint(null)
    try {
      const res = await testMcpClient(id)
      setHint(res.message)
    } catch (e) {
      setHint(e instanceof Error ? e.message : String(e))
    } finally {
      setTestingId(null)
    }
  }

  const fetchTools = async (id: string) => {
    setToolLoadingId(id)
    setHint(null)
    try {
      const list = await listMcpClientTools(id)
      setToolsByClient((prev) => ({ ...prev, [id]: list }))
      setHint(`已拉取工具：${list.length} 个`)
    } catch (e) {
      setHint(e instanceof Error ? e.message : String(e))
    } finally {
      setToolLoadingId(null)
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="mt-1 text-2xl font-semibold text-slate-900 dark:text-slate-50">
            MCP 客户端
          </h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            已启用 {enabledCount}/{clients.length}（仅 Streamable HTTP）
          </p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" disabled={busy} onClick={() => void loadAll()}>
            刷新
          </Button>
          <Button type="button" disabled={busy} onClick={openCreate}>
            创建客户端
          </Button>
        </div>
      </div>

      {hint ? (
        <p className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-300">
          {hint}
        </p>
      ) : null}

      {formOpen ? (
        <div className="mb-6 rounded-xl border border-slate-200 p-4 dark:border-slate-800">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
            {form.id ? '编辑客户端' : '创建客户端'}
          </h3>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="space-y-1.5">
              <div className="text-xs font-medium text-slate-700 dark:text-slate-300">名称</div>
              <input
                value={form.name}
                onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
                className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus-visible:ring-2 focus-visible:ring-slate-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                placeholder="例如：tavily_mcp"
              />
            </label>
            <label className="space-y-1.5">
              <div className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Transport
              </div>
              <input
                value="streamable_http"
                disabled
                className="h-9 w-full rounded-md border border-slate-200 bg-slate-100 px-3 text-sm text-slate-500 outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"
              />
            </label>
            <label className="space-y-1.5 md:col-span-2">
              <div className="text-xs font-medium text-slate-700 dark:text-slate-300">URL</div>
              <input
                value={form.url}
                onChange={(e) => setForm((s) => ({ ...s, url: e.target.value }))}
                className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus-visible:ring-2 focus-visible:ring-slate-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                placeholder="https://your-mcp-server.example.com/mcp"
              />
            </label>
            <label className="space-y-1.5 md:col-span-2">
              <div className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Bearer Token
              </div>
              <input
                type="password"
                value={form.bearerToken}
                onChange={(e) => setForm((s) => ({ ...s, bearerToken: e.target.value }))}
                className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus-visible:ring-2 focus-visible:ring-slate-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                placeholder="可选"
              />
            </label>
          </div>

          <div className="mt-4 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-xs font-medium text-slate-700 dark:text-slate-300">
                自定义 Headers
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  setForm((s) => ({ ...s, headers: [...s.headers, { key: '', value: '' }] }))
                }
              >
                添加 Header
              </Button>
            </div>
            <div className="space-y-2">
              {form.headers.map((h, idx) => (
                <div key={`header-${idx}`} className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
                  <input
                    value={h.key}
                    onChange={(e) =>
                      setForm((s) => ({
                        ...s,
                        headers: s.headers.map((row, i) =>
                          i === idx ? { ...row, key: e.target.value } : row,
                        ),
                      }))
                    }
                    className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus-visible:ring-2 focus-visible:ring-slate-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    placeholder="Header-Name"
                  />
                  <input
                    value={h.value}
                    onChange={(e) =>
                      setForm((s) => ({
                        ...s,
                        headers: s.headers.map((row, i) =>
                          i === idx ? { ...row, value: e.target.value } : row,
                        ),
                      }))
                    }
                    className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus-visible:ring-2 focus-visible:ring-slate-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    placeholder="Header Value"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      setForm((s) => ({
                        ...s,
                        headers:
                          s.headers.length > 1
                            ? s.headers.filter((_, i) => i !== idx)
                            : [{ key: '', value: '' }],
                      }))
                    }
                  >
                    删除
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-950/40">
            <div>
              <div className="text-xs font-medium text-slate-700 dark:text-slate-300">
                保存后立即启用
              </div>
              <div className="text-[11px] text-slate-600 dark:text-slate-400">
                关闭后保留配置，但不会用于调用
              </div>
            </div>
            <Switch
              checked={form.enabled}
              onChange={(e) => setForm((s) => ({ ...s, enabled: e.target.checked }))}
            />
          </div>

          <div className="mt-4 flex gap-2">
            <Button type="button" disabled={busy} onClick={() => void saveClient()}>
              保存
            </Button>
            <Button type="button" variant="outline" disabled={busy} onClick={closeForm}>
              取消
            </Button>
          </div>
        </div>
      ) : null}

      <div className="grid gap-3">
        {clients.map((item) => (
          <div
            key={item.id}
            className="rounded-xl border border-slate-200 p-4 dark:border-slate-800"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-base font-semibold text-slate-900 dark:text-slate-50">
                    {item.name}
                  </div>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                    {item.url.includes('localhost') || item.url.includes('127.0.0.1')
                      ? 'Local'
                      : 'Remote'}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        item.enabled ? 'bg-emerald-500' : 'bg-slate-400'
                      }`}
                    />
                    {item.enabled ? '已启用' : '已禁用'}
                  </span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                    streamable_http
                  </span>
                </div>
                <p className="mt-1 truncate text-xs text-slate-600 dark:text-slate-400">
                  {item.url}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Switch
                  checked={item.enabled}
                  disabled={busy}
                  onChange={(e) => void toggleEnabled(item.id, e.target.checked)}
                />
                <Button type="button" variant="outline" onClick={() => openEdit(item)}>
                  编辑
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={testingId === item.id}
                  onClick={() => void testConnection(item.id)}
                >
                  {testingId === item.id ? '测试中…' : '测试连接'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={toolLoadingId === item.id}
                  onClick={() => void fetchTools(item.id)}
                >
                  {toolLoadingId === item.id ? '拉取中…' : '拉取工具'}
                </Button>
                <Button type="button" variant="outline" onClick={() => void removeClient(item.id)}>
                  删除
                </Button>
              </div>
            </div>

            {toolsByClient[item.id]?.length ? (
              <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-950/40">
                <div className="mb-2 text-xs font-medium text-slate-700 dark:text-slate-300">
                  可用工具（{toolsByClient[item.id].length}）
                </div>
                <div className="space-y-1">
                  {toolsByClient[item.id].map((tool) => (
                    <div
                      key={`${item.id}-${tool.name}`}
                      className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs dark:border-slate-800 dark:bg-slate-900"
                    >
                      <div className="font-medium text-slate-900 dark:text-slate-100">
                        {tool.name}
                      </div>
                      {tool.description ? (
                        <div className="text-slate-600 dark:text-slate-400">{tool.description}</div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ))}

        {clients.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-400">
            暂无 MCP 客户端，点击右上角「创建客户端」开始。
          </p>
        ) : null}
      </div>
    </section>
  )
}

