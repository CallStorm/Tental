import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import {
  BookOpen,
  Copy,
  Eye,
  EyeOff,
  Grid3x3,
  List,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
  ScanEye,
  Upload,
  Zap,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SkillMarkdownPreview } from '@/components/skill-markdown-preview'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import {
  createSkill,
  deleteSkill,
  fileToBase64,
  getSkillContent,
  importSkillsZipFromBase64,
  listSkills,
  saveSkillContent,
  setSkillEnabled,
  type SkillMeta,
} from '@/lib/skills-api'

const SKILL_TEMPLATE = `---
name: my_skill
description: 简短说明该技能的用途
---

## 技能实现内容（Markdown）

在此编写技能正文、步骤说明与约束等。
`

function formatTimeAgo(ms: number): string {
  if (!ms || ms <= 0) return '—'
  const diff = Date.now() - ms
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return '刚刚'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} 分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} 小时前`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day} 天前`
  const month = Math.floor(day / 30)
  return `${month} 个月前`
}

export function SkillsPage() {
  const [skills, setSkills] = useState<SkillMeta[]>([])
  const [busy, setBusy] = useState(false)
  const [hint, setHint] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')

  const [formOpen, setFormOpen] = useState(false)
  const [formName, setFormName] = useState('')
  const [formContent, setFormContent] = useState(SKILL_TEMPLATE)
  const [formConfigText, setFormConfigText] = useState('{}')
  const [contentPreview, setContentPreview] = useState(false)

  const [editorOpen, setEditorOpen] = useState(false)
  const [editorName, setEditorName] = useState('')
  const [editorContent, setEditorContent] = useState('')
  const [editorPreview, setEditorPreview] = useState(false)

  const zipInputRef = useRef<HTMLInputElement | null>(null)

  const enabledCount = useMemo(() => skills.filter((s) => s.enabled).length, [skills])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return skills
    return skills.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q),
    )
  }, [skills, query])

  const loadAll = async () => {
    setHint(null)
    try {
      const list = await listSkills()
      setSkills(list)
    } catch (e) {
      setHint(e instanceof Error ? e.message : String(e))
    }
  }

  useEffect(() => {
    void loadAll()
  }, [])

  const openCreate = () => {
    setFormName('')
    setFormContent(SKILL_TEMPLATE)
    setFormConfigText('{}')
    setContentPreview(false)
    setFormOpen(true)
    setHint(null)
  }

  const closeForm = () => {
    setFormOpen(false)
  }

  const syncNameInContent = (name: string, content: string) => {
    const n = name.trim()
    if (!n || !content.trimStart().startsWith('---')) return content
    const lines = content.split('\n')
    const out: string[] = []
    let inFm = false
    let fmStarted = false
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? ''
      if (i === 0 && line.trim() === '---') {
        fmStarted = true
        inFm = true
        out.push(line)
        continue
      }
      if (inFm) {
        if (line.trim() === '---') {
          inFm = false
          out.push(line)
          continue
        }
        if (/^\s*name\s*:/i.test(line)) {
          out.push(`name: ${n}`)
          continue
        }
      }
      out.push(line)
    }
    if (!fmStarted) return content
    return out.join('\n')
  }

  const handleCreate = async () => {
    setHint(null)
    const name = formName.trim().toLowerCase()
    if (!name) {
      setHint('请填写技能名称')
      return
    }
    let config: unknown = {}
    try {
      config = JSON.parse(formConfigText || '{}')
      if (typeof config !== 'object' || config === null) {
        setHint('配置必须是 JSON 对象')
        return
      }
    } catch {
      setHint('配置 JSON 格式无效')
      return
    }
    const content = syncNameInContent(name, formContent)
    setBusy(true)
    try {
      await createSkill({ name, content, config })
      await loadAll()
      closeForm()
      setHint('已创建技能')
    } catch (e) {
      setHint(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const toggleEnabled = async (name: string, enabled: boolean) => {
    setBusy(true)
    setHint(null)
    try {
      await setSkillEnabled(name, enabled)
      setSkills((list) => list.map((x) => (x.name === name ? { ...x, enabled } : x)))
    } catch (e) {
      setHint(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const removeSkill = async (s: SkillMeta) => {
    if (s.source === 'builtin') {
      setHint('内置技能不能删除')
      return
    }
    const ok = window.confirm(`确定删除技能「${s.name}」吗？`)
    if (!ok) return
    setBusy(true)
    setHint(null)
    try {
      await deleteSkill(s.name)
      setSkills((list) => list.filter((x) => x.name !== s.name))
      setHint('已删除')
    } catch (e) {
      setHint(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const onPickZip = () => zipInputRef.current?.click()

  const onZipSelected = async (ev: ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0]
    ev.target.value = ''
    if (!file) return
    setBusy(true)
    setHint(null)
    try {
      const b64 = await fileToBase64(file)
      const res = await importSkillsZipFromBase64(b64)
      await loadAll()
      setHint(`导入成功：${res.imported.join(', ')}`)
    } catch (e) {
      setHint(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const copyTemplate = async () => {
    try {
      await navigator.clipboard.writeText(formContent)
      setHint('已复制内容')
    } catch {
      setHint('复制失败')
    }
  }

  const openEditor = async (s: SkillMeta) => {
    setHint(null)
    setEditorPreview(false)
    setEditorName(s.name)
    setEditorContent('')
    setEditorOpen(true)
    setBusy(true)
    try {
      const detail = await getSkillContent(s.name)
      setEditorContent(detail.content)
    } catch (e) {
      setHint(e instanceof Error ? e.message : String(e))
      setEditorOpen(false)
    } finally {
      setBusy(false)
    }
  }

  const closeEditor = () => {
    setEditorOpen(false)
    setEditorName('')
    setEditorContent('')
    setEditorPreview(false)
  }

  const handleSaveEditor = async () => {
    setHint(null)
    setBusy(true)
    try {
      await saveSkillContent({ name: editorName, content: editorContent })
      await loadAll()
      closeEditor()
      setHint('已保存')
    } catch (e) {
      setHint(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-2">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="mt-1 text-2xl font-semibold text-slate-900 dark:text-slate-50">
                技能
              </h2>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0 px-2"
                disabled={busy}
                onClick={() => void loadAll()}
                aria-label="刷新"
              >
                <RefreshCw className={cn('h-4 w-4', busy && 'animate-spin')} />
              </Button>
            </div>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              已启用 {enabledCount}/{skills.length} · 符合 Claude Skill 标准（SKILL.md）
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            ref={zipInputRef}
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            onChange={onZipSelected}
          />
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={onPickZip}
          >
            <Upload className="mr-2 h-4 w-4" />
            通过 zip 上传
          </Button>
          <Button
            type="button"
            className="bg-orange-500 hover:bg-orange-600 dark:bg-orange-600 dark:hover:bg-orange-500"
            disabled={busy}
            onClick={openCreate}
          >
            <Plus className="mr-2 h-4 w-4" />
            创建技能
          </Button>
        </div>
      </div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <input
          type="search"
          placeholder="按名称筛选"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full max-w-sm rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none ring-orange-500/30 focus:ring-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
        />
        <div className="flex gap-1 rounded-lg border border-slate-200 p-1 dark:border-slate-700">
          <Button
            type="button"
            size="sm"
            variant={viewMode === 'grid' ? 'default' : 'outline'}
            className={cn('gap-1', viewMode === 'grid' && 'bg-slate-800 dark:bg-slate-100')}
            onClick={() => setViewMode('grid')}
          >
            <Grid3x3 className="h-4 w-4" /> 卡片
          </Button>
          <Button
            type="button"
            size="sm"
            variant={viewMode === 'list' ? 'default' : 'outline'}
            className={cn('gap-1', viewMode === 'list' && 'bg-slate-800 dark:bg-slate-100')}
            onClick={() => setViewMode('list')}
          >
            <List className="h-4 w-4" /> 列表
          </Button>
        </div>
      </div>

      {hint ? (
        <p className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-300">
          {hint}
        </p>
      ) : null}

      {formOpen ? (
        <div className="skin-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="skin-modal-panel max-h-[90vh] w-full max-w-2xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-700">
              <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
                创建技能
              </h3>
              <button
                type="button"
                className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                onClick={closeForm}
                aria-label="关闭"
              >
                ×
              </button>
            </div>
            <div className="max-h-[calc(90vh-8rem)] overflow-y-auto px-5 py-4">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                <span className="text-red-500">*</span> Name
              </label>
              <input
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                placeholder="例如：weather_query"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
              />
              <div className="mt-4 flex items-center justify-between gap-2">
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  <span className="text-red-500">*</span> Content
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">预览</span>
                  <Switch
                    checked={contentPreview}
                    onChange={(e) => setContentPreview(e.target.checked)}
                  />
                  <Button type="button" size="sm" variant="outline" onClick={() => void copyTemplate()}>
                    <Copy className="mr-1 h-3 w-3" /> 复制
                  </Button>
                </div>
              </div>
              {contentPreview ? (
                <SkillMarkdownPreview
                  source={formContent}
                  className="mt-2 max-h-64 overflow-auto rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-600 dark:bg-slate-900/80"
                />
              ) : (
                <textarea
                  className="mt-2 max-h-64 min-h-[200px] w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
                  value={formContent}
                  onChange={(e) => setFormContent(e.target.value)}
                />
              )}
              <label className="mt-4 block text-sm font-medium text-slate-700 dark:text-slate-300">
                配置（JSON）
              </label>
              <textarea
                className="mt-1 max-h-32 min-h-[80px] w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
                value={formConfigText}
                onChange={(e) => setFormConfigText(e.target.value)}
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-5 py-4 dark:border-slate-700">
              <Button type="button" variant="outline" disabled title="后续可接模型优化">
                <Sparkles className="mr-2 h-4 w-4" /> AI优化
              </Button>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={closeForm} disabled={busy}>
                  取消
                </Button>
                <Button
                  type="button"
                  className="bg-orange-500 hover:bg-orange-600"
                  disabled={busy}
                  onClick={() => void handleCreate()}
                >
                  {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  创建
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {editorOpen ? (
        <div className="skin-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="skin-modal-panel max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-700">
              <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
                编辑技能
              </h3>
              <button
                type="button"
                className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                onClick={closeEditor}
                aria-label="关闭"
              >
                ×
              </button>
            </div>
            <div className="max-h-[calc(90vh-8rem)] overflow-y-auto px-5 py-4">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                技能名称
              </label>
              <input
                readOnly
                className="mt-1 w-full cursor-default rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                value={editorName}
              />
              <div className="mt-4 flex items-center justify-between gap-2">
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  内容
                </label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setEditorPreview((v) => !v)}
                >
                  <ScanEye className="mr-1 h-3.5 w-3.5" />
                  {editorPreview ? '关闭预览' : '预览'}
                </Button>
              </div>
              {editorPreview ? (
                <SkillMarkdownPreview
                  source={editorContent}
                  className="mt-2 min-h-[220px] max-h-80 overflow-auto rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-600 dark:bg-slate-900/80"
                />
              ) : (
                <textarea
                  className="mt-2 min-h-[280px] w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
                  value={editorContent}
                  onChange={(e) => setEditorContent(e.target.value)}
                  spellCheck={false}
                />
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4 dark:border-slate-700">
              <Button type="button" variant="outline" onClick={closeEditor} disabled={busy}>
                取消
              </Button>
              <Button
                type="button"
                className="bg-orange-500 hover:bg-orange-600"
                disabled={busy}
                onClick={() => void handleSaveEditor()}
              >
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                保存
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {viewMode === 'grid' ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((s) => {
            const Icon = s.source === 'builtin' ? BookOpen : Zap
            return (
              <article
                key={s.name}
                role="button"
                tabIndex={0}
                className="flex flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-orange-300 hover:shadow-md dark:border-slate-800 dark:bg-slate-950/60 dark:hover:border-orange-700"
                onClick={() => void openEditor(s)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    void openEditor(s)
                  }
                }}
              >
                <div className="mb-3 flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800">
                      <Icon className="h-5 w-5 text-slate-600 dark:text-slate-300" />
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-slate-900 dark:text-slate-50">
                          {s.name}
                        </span>
                        <span
                          className={cn(
                            'rounded px-1.5 py-0.5 text-[10px] font-medium',
                            s.source === 'builtin'
                              ? 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                              : 'bg-orange-100 text-orange-800 dark:bg-orange-950/80 dark:text-orange-200',
                          )}
                        >
                          {s.source === 'builtin' ? '内置' : '自定义'}
                        </span>
                      </div>
                    </div>
                  </div>
                  <span
                    className={cn(
                      'shrink-0 text-xs font-medium',
                      s.enabled ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400',
                    )}
                  >
                    ● {s.enabled ? '已启用' : '已禁用'}
                  </span>
                </div>
                <dl className="mb-2 space-y-1 text-xs text-slate-600 dark:text-slate-400">
                  <div className="flex justify-between gap-2">
                    <dt>适用频道</dt>
                    <dd className="text-slate-800 dark:text-slate-200">{s.applicableChannels}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt>更新时间</dt>
                    <dd className="text-slate-800 dark:text-slate-200">
                      {formatTimeAgo(s.updatedAt)}
                    </dd>
                  </div>
                </dl>
                <p className="mb-4 line-clamp-3 flex-1 text-sm text-slate-700 dark:text-slate-300">
                  <span className="text-xs font-medium text-slate-500">描述 </span>
                  {s.description}
                </p>
                <div className="mt-auto flex flex-wrap gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    className="gap-1"
                    onClick={(e) => {
                      e.stopPropagation()
                      void toggleEnabled(s.name, !s.enabled)
                    }}
                  >
                    {s.enabled ? (
                      <EyeOff className="h-3.5 w-3.5" />
                    ) : (
                      <Eye className="h-3.5 w-3.5" />
                    )}
                    {s.enabled ? '禁用' : '启用'}
                  </Button>
                  {s.source !== 'builtin' ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="ml-auto border-red-200 text-red-600 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950/40"
                      disabled={busy}
                      onClick={(e) => {
                        e.stopPropagation()
                        void removeSkill(s)
                      }}
                    >
                      删除
                    </Button>
                  ) : null}
                </div>
              </article>
            )
          })}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-600 dark:bg-slate-950 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3 font-medium">名称</th>
                <th className="px-4 py-3 font-medium">来源</th>
                <th className="px-4 py-3 font-medium">频道</th>
                <th className="px-4 py-3 font-medium">更新</th>
                <th className="px-4 py-3 font-medium">状态</th>
                <th className="px-4 py-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr
                  key={s.name}
                  className="cursor-pointer border-t border-slate-100 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900/50"
                  onClick={() => void openEditor(s)}
                >
                  <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-50">
                    {s.name}
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                    {s.source === 'builtin' ? '内置' : '自定义'}
                  </td>
                  <td className="px-4 py-3">{s.applicableChannels}</td>
                  <td className="px-4 py-3 text-slate-600">{formatTimeAgo(s.updatedAt)}</td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <Switch
                      checked={s.enabled}
                      disabled={busy}
                      onChange={(e) => void toggleEnabled(s.name, e.target.checked)}
                    />
                  </td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    {s.source !== 'builtin' ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="border-transparent text-red-600 shadow-none hover:bg-red-50 dark:hover:bg-red-950/40"
                      disabled={busy}
                      onClick={(e) => {
                        e.stopPropagation()
                        void removeSkill(s)
                      }}
                    >
                      删除
                    </Button>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {filtered.length === 0 ? (
        <p className="mt-8 text-center text-sm text-slate-500">暂无技能，请创建或通过 zip 导入</p>
      ) : null}
    </section>
  )
}
