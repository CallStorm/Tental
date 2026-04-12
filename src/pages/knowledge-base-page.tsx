import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import {
  ChevronRight,
  FileText,
  Folder,
  FolderPlus,
  Loader2,
  Pencil,
  RefreshCw,
  Search,
  X,
} from 'lucide-react'

import { KnowledgeDocumentEditor } from '@/components/knowledge-document-editor'
import { KnowledgeMarkdown } from '@/components/knowledge-markdown'
import { Button } from '@/components/ui/button'
import { joinKbRel, parentRelPath } from '@/lib/kb-doc-format'
import {
  kbDelete,
  kbListTree,
  kbMkdir,
  kbRead,
  kbRename,
  kbSearch,
  kbWrite,
  type KbSearchHit,
  type KbTreeEntry,
} from '@/lib/knowledge-api'
import { getTentalDir } from '@/lib/tauri-config'
import { cn } from '@/lib/utils'

const NEW_NOTE_TEMPLATE = `---
title: 新笔记
tags: []
---

`

function collectTagsFromTree(nodes: KbTreeEntry[]): string[] {
  const s = new Set<string>()
  function walk(list: KbTreeEntry[]) {
    for (const n of list) {
      if (n.kind === 'file' && n.tags?.length) {
        for (const t of n.tags) {
          const v = t.trim()
          if (v) s.add(v)
        }
      }
      if (n.children?.length) walk(n.children)
    }
  }
  walk(nodes)
  return [...s].sort((a, b) => a.localeCompare(b))
}

function findTitleInTree(nodes: KbTreeEntry[], relPath: string): string | undefined {
  for (const n of nodes) {
    if (n.kind === 'file' && n.relPath === relPath) return n.title
    if (n.children?.length) {
      const t = findTitleInTree(n.children, relPath)
      if (t) return t
    }
  }
  return undefined
}

function FolderRow({
  node,
  depth,
  selectedFilePath,
  contextDirRel,
  onOpenFile,
  onSelectContextDir,
  onTreeContextMenu,
}: {
  node: KbTreeEntry
  depth: number
  selectedFilePath: string | null
  contextDirRel: string
  onOpenFile: (relPath: string) => void
  onSelectContextDir: (relPath: string) => void
  onTreeContextMenu: (
    e: ReactMouseEvent,
    payload: { kind: 'file' | 'dir'; relPath: string; label: string },
  ) => void
}) {
  const [open, setOpen] = useState(true)
  const children = node.children ?? []
  const hasKids = children.length > 0

  return (
    <div>
      <div
        className="flex items-center gap-0.5 py-0.5 text-sm"
        onContextMenu={(e) =>
          onTreeContextMenu(e, {
            kind: 'dir',
            relPath: node.relPath,
            label: node.name || '（根）',
          })
        }
      >
        <button
          type="button"
          className="rounded p-0.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          aria-label={open ? '折叠' : '展开'}
          onClick={() => setOpen(!open)}
        >
          <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 transition', open && 'rotate-90')} />
        </button>
        <button
          type="button"
          className={cn(
            'flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-left',
            contextDirRel === node.relPath
              ? 'bg-violet-100 text-violet-900 dark:bg-violet-950/50 dark:text-violet-100'
              : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800',
          )}
          onClick={() => onSelectContextDir(node.relPath)}
        >
          <Folder className="h-3.5 w-3.5 shrink-0 text-amber-600" />
          <span className="truncate">{node.name || '（根）'}</span>
        </button>
      </div>
      {open && hasKids ? (
        <KbTreeList
          nodes={children}
          depth={depth + 1}
          selectedFilePath={selectedFilePath}
          contextDirRel={contextDirRel}
          onOpenFile={onOpenFile}
          onSelectContextDir={onSelectContextDir}
          onTreeContextMenu={onTreeContextMenu}
        />
      ) : null}
      {open && !hasKids ? (
        <p className="py-1 pl-8 text-xs text-slate-400">空目录</p>
      ) : null}
    </div>
  )
}

function KbTreeList({
  nodes,
  depth,
  selectedFilePath,
  contextDirRel,
  onOpenFile,
  onSelectContextDir,
  onTreeContextMenu,
}: {
  nodes: KbTreeEntry[]
  depth: number
  selectedFilePath: string | null
  contextDirRel: string
  onOpenFile: (relPath: string) => void
  onSelectContextDir: (relPath: string) => void
  onTreeContextMenu: (
    e: ReactMouseEvent,
    payload: { kind: 'file' | 'dir'; relPath: string; label: string },
  ) => void
}) {
  return (
    <ul className={cn('space-y-0.5', depth > 0 && 'ml-2 border-l border-slate-200 pl-2 dark:border-slate-700')}>
      {nodes.map((n) => (
        <li key={`${n.kind}-${n.relPath}`}>
          {n.kind === 'dir' ? (
            <FolderRow
              node={n}
              depth={depth}
              selectedFilePath={selectedFilePath}
              contextDirRel={contextDirRel}
              onOpenFile={onOpenFile}
              onSelectContextDir={onSelectContextDir}
              onTreeContextMenu={onTreeContextMenu}
            />
          ) : (
            <button
              type="button"
              onClick={() => {
                onOpenFile(n.relPath)
                onSelectContextDir(parentRelPath(n.relPath))
              }}
              onContextMenu={(e) =>
                onTreeContextMenu(e, {
                  kind: 'file',
                  relPath: n.relPath,
                  label: n.title ?? n.name,
                })
              }
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition',
                selectedFilePath === n.relPath
                  ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                  : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800',
              )}
            >
              <FileText className="h-3.5 w-3.5 shrink-0 opacity-80" />
              <span className="truncate">{n.title ?? n.name}</span>
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}

export function KnowledgeBasePage() {
  const [tree, setTree] = useState<KbTreeEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [hint, setHint] = useState<string | null>(null)
  const [kbRootHint, setKbRootHint] = useState<string | null>(null)

  const [keyword, setKeyword] = useState('')
  const [debouncedKeyword, setDebouncedKeyword] = useState('')
  const [selectedTags, setSelectedTags] = useState<string[]>([])

  const [searchHits, setSearchHits] = useState<KbSearchHit[]>([])
  const [searchLoading, setSearchLoading] = useState(false)

  const [contextDirRel, setContextDirRel] = useState('')
  const [mkdirOpen, setMkdirOpen] = useState(false)
  const [mkdirName, setMkdirName] = useState('')

  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [docTitle, setDocTitle] = useState<string>('')
  const [rawContent, setRawContent] = useState<string>('')
  const [editing, setEditing] = useState(false)
  const [saveBusy, setSaveBusy] = useState(false)

  const [treeCtx, setTreeCtx] = useState<{
    kind: 'file' | 'dir'
    relPath: string
    label: string
    x: number
    y: number
  } | null>(null)
  const treeCtxMenuRef = useRef<HTMLDivElement | null>(null)

  const filterActive = debouncedKeyword.trim().length > 0 || selectedTags.length > 0

  const openTreeContextMenu = useCallback(
    (
      e: ReactMouseEvent,
      payload: { kind: 'file' | 'dir'; relPath: string; label: string },
    ) => {
      e.preventDefault()
      e.stopPropagation()
      setTreeCtx({
        ...payload,
        x: e.clientX,
        y: e.clientY,
      })
    },
    [],
  )

  useEffect(() => {
    if (!treeCtx) return
    const onDown = (ev: MouseEvent) => {
      if (treeCtxMenuRef.current?.contains(ev.target as Node)) return
      setTreeCtx(null)
    }
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setTreeCtx(null)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [treeCtx])

  const loadTree = useCallback(async () => {
    setHint(null)
    try {
      const t = await kbListTree()
      setTree(t)
    } catch (e) {
      setHint(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadTree()
    void (async () => {
      try {
        const dir = await getTentalDir()
        setKbRootHint(`${dir}\\kbs`)
      } catch {
        setKbRootHint('~/.tental/kbs')
      }
    })()
  }, [loadTree])

  useEffect(() => {
    const t = setTimeout(() => setDebouncedKeyword(keyword), 320)
    return () => clearTimeout(t)
  }, [keyword])

  useEffect(() => {
    if (!filterActive) {
      setSearchHits([])
      setSearchLoading(false)
      return
    }
    let cancelled = false
    setSearchLoading(true)
    void (async () => {
      try {
        const hits = await kbSearch(debouncedKeyword.trim() || undefined, selectedTags)
        if (!cancelled) setSearchHits(hits)
      } catch (e) {
        if (!cancelled) setHint(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setSearchLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [filterActive, debouncedKeyword, selectedTags])

  const allTags = useMemo(() => collectTagsFromTree(tree), [tree])

  const openDoc = useCallback(
    async (relPath: string, titleHint?: string) => {
      setHint(null)
      setSelectedPath(relPath)
      setEditing(false)
      try {
        const text = await kbRead(relPath)
        setRawContent(text)
        const fromTree = findTitleInTree(tree, relPath)
        setDocTitle(fromTree ?? titleHint ?? relPath)
      } catch (e) {
        setHint(e instanceof Error ? e.message : String(e))
      }
    },
    [tree],
  )

  useEffect(() => {
    if (!selectedPath) return
    const t = findTitleInTree(tree, selectedPath)
    if (t) setDocTitle(t)
  }, [tree, selectedPath])

  const handleEditorSave = useCallback(
    async (raw: string) => {
      if (!selectedPath) return
      setSaveBusy(true)
      setHint(null)
      try {
        await kbWrite(selectedPath, raw)
        setRawContent(raw)
        await loadTree()
        setEditing(false)
      } catch (e) {
        setHint(e instanceof Error ? e.message : String(e))
      } finally {
        setSaveBusy(false)
      }
    },
    [selectedPath, loadTree],
  )

  const handleEditorCancel = useCallback(async () => {
    if (!selectedPath) return
    setEditing(false)
    try {
      const text = await kbRead(selectedPath)
      setRawContent(text)
    } catch {
      // keep buffer
    }
  }, [selectedPath])

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    )
  }

  const clearFilters = () => {
    setKeyword('')
    setDebouncedKeyword('')
    setSelectedTags([])
  }

  const createNewNote = async () => {
    const base = contextDirRel ? `${contextDirRel}/` : ''
    const name = `${base}笔记-${Date.now()}.md`
    setHint(null)
    try {
      await kbWrite(name, NEW_NOTE_TEMPLATE)
      await loadTree()
      await openDoc(name)
      setEditing(true)
    } catch (e) {
      setHint(e instanceof Error ? e.message : String(e))
    }
  }

  const submitMkdir = async () => {
    const raw = mkdirName.trim().replace(/\\/g, '/')
    if (!raw || raw.includes('..') || raw.startsWith('/')) {
      setHint('请输入有效的文件夹名称（不含 .. 或绝对路径）')
      return
    }
    setHint(null)
    try {
      const path = contextDirRel ? joinKbRel(contextDirRel, raw) : raw
      await kbMkdir(path)
      setMkdirOpen(false)
      setMkdirName('')
      await loadTree()
      setContextDirRel(path)
    } catch (e) {
      setHint(e instanceof Error ? e.message : String(e))
    }
  }

  const deleteCurrent = async () => {
    if (!selectedPath) return
    if (!window.confirm(`删除「${selectedPath}」？`)) return
    setHint(null)
    try {
      await kbDelete(selectedPath)
      setSelectedPath(null)
      setRawContent('')
      setDocTitle('')
      await loadTree()
    } catch (e) {
      setHint(e instanceof Error ? e.message : String(e))
    }
  }

  const deleteNoteAt = async (relPath: string) => {
    if (!window.confirm(`删除笔记「${relPath}」？`)) return
    setTreeCtx(null)
    setHint(null)
    try {
      await kbDelete(relPath)
      if (selectedPath === relPath) {
        setSelectedPath(null)
        setRawContent('')
        setDocTitle('')
        setEditing(false)
      }
      await loadTree()
    } catch (e) {
      setHint(e instanceof Error ? e.message : String(e))
    }
  }

  const moveNoteTo = async (fromRel: string) => {
    const suggested = fromRel.replace(/\\/g, '/')
    const toRel = window.prompt('移动到新的相对路径（从知识库根算起，须含 .md）', suggested)
    if (toRel == null) return
    const normalized = toRel.trim().replace(/\\/g, '/')
    if (!normalized || normalized.includes('..') || normalized.startsWith('/')) {
      setHint('路径无效：不能为空，不能含 .. 或绝对路径')
      setTreeCtx(null)
      return
    }
    if (normalized === fromRel.replace(/\\/g, '/')) {
      setTreeCtx(null)
      return
    }
    setTreeCtx(null)
    setHint(null)
    try {
      await kbRename(fromRel, normalized)
      if (selectedPath === fromRel) {
        setSelectedPath(normalized)
      }
      await loadTree()
    } catch (e) {
      setHint(e instanceof Error ? e.message : String(e))
    }
  }

  const openMkdirUnderTreeDir = (dirRelPath: string) => {
    setTreeCtx(null)
    setContextDirRel(dirRelPath)
    setMkdirName('')
    setMkdirOpen(true)
  }

  const treeCtxMenuPosition = treeCtx
    ? {
        left: Math.min(treeCtx.x, typeof window !== 'undefined' ? window.innerWidth - 196 : treeCtx.x),
        top: Math.min(treeCtx.y, typeof window !== 'undefined' ? window.innerHeight - 120 : treeCtx.y),
      }
    : { left: 0, top: 0 }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            知识库
          </h1>
          <p className="mt-1 max-w-xl text-sm text-slate-500 dark:text-slate-400">
            Markdown 文件存储在{' '}
            <code className="rounded bg-slate-100 px-1 py-0.5 text-xs dark:bg-slate-800">
              {kbRootHint ?? '…'}
            </code>
            ，编辑时使用可视化文档模式，保存仍为 Markdown。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void loadTree()}>
            <RefreshCw className="h-4 w-4" />
            刷新
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setMkdirOpen(true)}>
            <FolderPlus className="h-4 w-4" />
            新建目录
          </Button>
          <Button type="button" size="sm" onClick={() => void createNewNote()}>
            新建笔记
          </Button>
        </div>
      </div>

      {hint ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200">
          {hint}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 gap-4">
        <aside className="flex w-full max-w-sm shrink-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/40">
          <div className="space-y-2 border-b border-slate-200 p-3 dark:border-slate-800">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              创建位置：
              <span className="font-medium text-slate-700 dark:text-slate-200">
                {contextDirRel ? contextDirRel : '根目录'}
              </span>
              <span className="text-slate-400">（点击文件夹或打开文件可切换）</span>
            </p>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="关键字（标题与正文）"
                className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-8 text-sm outline-none ring-violet-500/30 focus:border-violet-500 focus:ring-2 dark:border-slate-700 dark:bg-slate-950"
              />
              {keyword ? (
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  onClick={() => setKeyword('')}
                  aria-label="清除关键字"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </div>
            {allTags.length > 0 ? (
              <div>
                <p className="mb-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
                  标签（多选为且）
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {allTags.map((tag) => {
                    const on = selectedTags.includes(tag)
                    return (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => toggleTag(tag)}
                        className={cn(
                          'rounded-full px-2.5 py-0.5 text-xs transition',
                          on
                            ? 'bg-violet-600 text-white dark:bg-violet-500'
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700',
                        )}
                      >
                        {tag}
                      </button>
                    )
                  })}
                </div>
              </div>
            ) : null}
            {filterActive ? (
              <Button type="button" variant="outline" size="sm" className="w-full" onClick={clearFilters}>
                清除筛选
              </Button>
            ) : null}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {loading ? (
              <div className="flex items-center gap-2 p-4 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                加载目录…
              </div>
            ) : filterActive ? (
              <div className="space-y-1">
                {searchLoading ? (
                  <div className="flex items-center gap-2 p-2 text-sm text-slate-500">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    检索中…
                  </div>
                ) : searchHits.length === 0 ? (
                  <p className="p-2 text-sm text-slate-500">无匹配文档</p>
                ) : (
                  searchHits.map((h) => (
                    <button
                      key={h.relPath}
                      type="button"
                      onClick={() => void openDoc(h.relPath, h.title)}
                      onContextMenu={(e) =>
                        openTreeContextMenu(e, {
                          kind: 'file',
                          relPath: h.relPath,
                          label: h.title,
                        })
                      }
                      className={cn(
                        'w-full rounded-lg border px-2 py-2 text-left text-sm transition',
                        selectedPath === h.relPath
                          ? 'border-violet-500 bg-violet-50 dark:border-violet-500 dark:bg-violet-950/40'
                          : 'border-transparent hover:bg-slate-50 dark:hover:bg-slate-800/80',
                      )}
                    >
                      <div className="font-medium text-slate-900 dark:text-slate-100">{h.title}</div>
                      <div className="truncate text-xs text-slate-500 dark:text-slate-400">{h.relPath}</div>
                      {h.tags.length > 0 ? (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {h.tags.map((t) => (
                            <span
                              key={t}
                              className="rounded bg-slate-100 px-1.5 py-0 text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                            >
                              {t}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </button>
                  ))
                )}
              </div>
            ) : tree.length === 0 ? (
              <p className="p-3 text-sm text-slate-500">
                目录为空。点击「新建笔记 / 新建目录」或向 kbs 目录添加 .md 文件。
              </p>
            ) : (
              <KbTreeList
                nodes={tree}
                depth={0}
                selectedFilePath={selectedPath}
                contextDirRel={contextDirRel}
                onOpenFile={(p) => void openDoc(p)}
                onSelectContextDir={setContextDirRel}
                onTreeContextMenu={openTreeContextMenu}
              />
            )}
          </div>
        </aside>

        <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/40">
          {selectedPath && editing ? (
            <KnowledgeDocumentEditor
              docKey={selectedPath}
              initialRaw={rawContent}
              onSave={handleEditorSave}
              onCancel={() => void handleEditorCancel()}
              saveBusy={saveBusy}
            />
          ) : selectedPath ? (
            <>
              <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
                <h2 className="min-w-0 flex-1 truncate text-lg font-semibold text-slate-900 dark:text-slate-100">
                  {docTitle || selectedPath}
                </h2>
                <code className="hidden max-w-md truncate rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600 md:block dark:bg-slate-800 dark:text-slate-300">
                  {selectedPath}
                </code>
                <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}>
                  <Pencil className="h-4 w-4" />
                  编辑
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => void deleteCurrent()}>
                  删除
                </Button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <KnowledgeMarkdown text={rawContent} docRelPath={selectedPath} />
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-slate-500">
              选择左侧文档，或使用关键字 / 标签检索。
            </div>
          )}
        </section>
      </div>

      {treeCtx ? (
        <div
          ref={treeCtxMenuRef}
          role="menu"
          className="fixed z-[200] min-w-[11rem] rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-900"
          style={{ left: treeCtxMenuPosition.left, top: treeCtxMenuPosition.top }}
        >
          {treeCtx.kind === 'file' ? (
            <>
              <button
                type="button"
                role="menuitem"
                className="block w-full px-3 py-2 text-left text-slate-800 hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-slate-800"
                onClick={() => void moveNoteTo(treeCtx.relPath)}
              >
                移动…
              </button>
              <button
                type="button"
                role="menuitem"
                className="block w-full px-3 py-2 text-left text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                onClick={() => void deleteNoteAt(treeCtx.relPath)}
              >
                删除
              </button>
            </>
          ) : (
            <button
              type="button"
              role="menuitem"
              className="block w-full px-3 py-2 text-left text-slate-800 hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-slate-800"
              onClick={() => openMkdirUnderTreeDir(treeCtx.relPath)}
            >
              新建子目录…
            </button>
          )}
        </div>
      ) : null}

      {mkdirOpen ? (
        <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-4 shadow-lg dark:border-slate-700 dark:bg-slate-900">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">新建目录</h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              将在「{contextDirRel || '根目录'}」下创建子文件夹。
            </p>
            <input
              type="text"
              value={mkdirName}
              onChange={(e) => setMkdirName(e.target.value)}
              placeholder="文件夹名称，可含多级如 notes/2024"
              className="mt-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submitMkdir()
              }}
            />
            <div className="mt-4 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setMkdirOpen(false)
                  setMkdirName('')
                }}
              >
                取消
              </Button>
              <Button type="button" size="sm" onClick={() => void submitMkdir()}>
                创建
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
