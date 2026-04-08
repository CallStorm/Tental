import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import {
  listTools,
  loadToolSecurity,
  saveToolSecurity,
  setToolEnabled,
  type ToolMeta,
  type ToolSecurityConfig,
} from '@/lib/tools-api'

type TabKey = 'tools' | 'security'

const defaultSecurity: ToolSecurityConfig = {
  allowedRoots: [],
  commandAllowlist: [],
  commandBlacklist: [],
  maxFileBytes: 5 * 1024 * 1024,
  maxReadLines: 2000,
  rejectBinary: true,
}

function splitLines(s: string): string[] {
  return s
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean)
}

function joinLines(list: string[]): string {
  return (list ?? []).join('\n')
}

export function ToolsPage() {
  const { t } = useTranslation()
  const [tab, setTab] = useState<TabKey>('tools')
  const [tools, setTools] = useState<ToolMeta[]>([])
  const [security, setSecurity] = useState<ToolSecurityConfig>(defaultSecurity)
  const [busy, setBusy] = useState(false)
  const [hint, setHint] = useState<string | null>(null)

  const loadAll = async () => {
    setHint(null)
    const [toolList, sec] = await Promise.all([listTools(), loadToolSecurity()])
    setTools(toolList)
    setSecurity(sec ?? defaultSecurity)
  }

  useEffect(() => {
    void loadAll()
  }, [])

  const enabledCount = useMemo(() => tools.filter((x) => x.enabled).length, [tools])

  const toggleTool = async (toolId: string, enabled: boolean) => {
    setBusy(true)
    setHint(null)
    try {
      await setToolEnabled(toolId, enabled)
      setTools((list) => list.map((x) => (x.id === toolId ? { ...x, enabled } : x)))
    } catch (e) {
      setHint(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const saveSecurity = async () => {
    setBusy(true)
    setHint(null)
    try {
      await saveToolSecurity(security)
      setHint(t('common.saved', '已保存'))
    } catch (e) {
      setHint(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold">工具</h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            已启用 {enabledCount}/{tools.length}
          </p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" disabled={busy} onClick={() => void loadAll()}>
            刷新
          </Button>
          {tab === 'security' ? (
            <Button type="button" disabled={busy} onClick={() => void saveSecurity()}>
              保存
            </Button>
          ) : null}
        </div>
      </div>

      <div className="mb-5 flex gap-2 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
        <button
          type="button"
          onClick={() => setTab('tools')}
          className={cn(
            'flex-1 rounded-lg px-3 py-2 text-sm font-medium transition',
            tab === 'tools'
              ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-50'
              : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-50',
          )}
        >
          工具
        </button>
        <button
          type="button"
          onClick={() => setTab('security')}
          className={cn(
            'flex-1 rounded-lg px-3 py-2 text-sm font-medium transition',
            tab === 'security'
              ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-50'
              : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-50',
          )}
        >
          安全
        </button>
      </div>

      {hint ? (
        <p className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-300">
          {hint}
        </p>
      ) : null}

      {tab === 'tools' ? (
        <div className="space-y-3">
          {tools.map((tool) => (
            <div
              key={tool.id}
              className="rounded-xl border border-slate-200 p-4 dark:border-slate-800"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="font-semibold text-slate-900 dark:text-slate-50">
                      {tool.name}
                    </div>
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-xs font-medium',
                        tool.risk === 'danger'
                          ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200'
                          : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200',
                      )}
                    >
                      {tool.risk === 'danger' ? '危险' : '安全'}
                    </span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                      {tool.id}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                    {tool.description}
                  </p>
                </div>
                <div className="shrink-0 pt-0.5">
                  <Switch
                    checked={tool.enabled}
                    disabled={busy}
                    onChange={(e) => void toggleTool(tool.id, e.target.checked)}
                  />
                </div>
              </div>
            </div>
          ))}
          {tools.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-400">
              暂无工具
            </p>
          ) : null}
        </div>
      ) : (
        <div className="space-y-6">
          <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
              路径设置
            </h3>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
              每行一个允许根目录。留空表示默认不限制。
            </p>
            <textarea
              value={joinLines(security.allowedRoots)}
              onChange={(e) =>
                setSecurity((s) => ({ ...s, allowedRoots: splitLines(e.target.value) }))
              }
              rows={5}
              className="mt-3 w-full resize-none rounded-lg border border-slate-200 bg-white p-3 font-mono text-xs text-slate-900 outline-none focus-visible:ring-2 focus-visible:ring-slate-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              placeholder="例如：\nC:\\Users\\Administrator\\Desktop\nE:\\2026\\Tental"
            />
          </div>

          <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
              命令执行限制
            </h3>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
              允许列表用于默认限制。黑名单命令需要用户审批后才执行。
            </p>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div>
                <div className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  允许列表（每行一个命令）
                </div>
                <textarea
                  value={joinLines(security.commandAllowlist)}
                  onChange={(e) =>
                    setSecurity((s) => ({
                      ...s,
                      commandAllowlist: splitLines(e.target.value),
                    }))
                  }
                  rows={8}
                  className="mt-2 w-full resize-none rounded-lg border border-slate-200 bg-white p-3 font-mono text-xs text-slate-900 outline-none focus-visible:ring-2 focus-visible:ring-slate-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  placeholder="git\nnode\nnpm\npnpm\npython"
                />
              </div>
              <div>
                <div className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  黑名单（每行一个命令）
                </div>
                <textarea
                  value={joinLines(security.commandBlacklist)}
                  onChange={(e) =>
                    setSecurity((s) => ({
                      ...s,
                      commandBlacklist: splitLines(e.target.value),
                    }))
                  }
                  rows={8}
                  className="mt-2 w-full resize-none rounded-lg border border-slate-200 bg-white p-3 font-mono text-xs text-slate-900 outline-none focus-visible:ring-2 focus-visible:ring-slate-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  placeholder="rm\ndel\nrmdir\nformat\ndiskpart\nshutdown"
                />
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
              文件读写限制
            </h3>
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <div className="space-y-1.5">
                <div className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  最大文件大小（bytes）
                </div>
                <input
                  type="number"
                  value={security.maxFileBytes}
                  onChange={(e) =>
                    setSecurity((s) => ({ ...s, maxFileBytes: Number(e.target.value) }))
                  }
                  className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus-visible:ring-2 focus-visible:ring-slate-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
              <div className="space-y-1.5">
                <div className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  读取最大返回行数
                </div>
                <input
                  type="number"
                  value={security.maxReadLines}
                  onChange={(e) =>
                    setSecurity((s) => ({ ...s, maxReadLines: Number(e.target.value) }))
                  }
                  className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus-visible:ring-2 focus-visible:ring-slate-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
              <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-950/40">
                <div className="min-w-0">
                  <div className="text-xs font-medium text-slate-700 dark:text-slate-300">
                    拒绝二进制文件
                  </div>
                  <div className="text-[11px] text-slate-600 dark:text-slate-400">
                    读取时检测空字节并拒绝
                  </div>
                </div>
                <Switch
                  checked={security.rejectBinary}
                  disabled={busy}
                  onChange={(e) =>
                    setSecurity((s) => ({ ...s, rejectBinary: e.target.checked }))
                  }
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

