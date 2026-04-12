import type { Editor } from '@tiptap/core'
import { Highlight } from '@tiptap/extension-highlight'
import { Image } from '@tiptap/extension-image'
import { Link } from '@tiptap/extension-link'
import { Placeholder } from '@tiptap/extension-placeholder'
import { Table } from '@tiptap/extension-table'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import { TableRow } from '@tiptap/extension-table-row'
import { TextAlign } from '@tiptap/extension-text-align'
import { TextStyle } from '@tiptap/extension-text-style'
import { Color } from '@tiptap/extension-color'
import { Underline } from '@tiptap/extension-underline'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Code,
  Heading1,
  HelpCircle,
  ImageIcon,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  Quote,
  Redo2,
  Sparkles,
  Strikethrough,
  Table2,
  Underline as UnderlineIcon,
  Undo2,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useReducer, useState } from 'react'

import { KnowledgeSelectionAi } from '@/components/knowledge-selection-ai'
import { Button } from '@/components/ui/button'
import {
  htmlToMarkdown,
  markdownToHtml,
  parseKbDocument,
  serializeKbDocument,
  type KbDocParts,
} from '@/lib/kb-doc-format'
import { cn } from '@/lib/utils'

type KnowledgeDocumentEditorProps = {
  docKey: string
  initialRaw: string
  onSave: (raw: string) => Promise<void>
  onCancel: () => void
  saveBusy: boolean
}

function ToolbarButton({
  active,
  disabled,
  onClick,
  title,
  children,
}: {
  active?: boolean
  disabled?: boolean
  onClick: () => void
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-sm transition',
        active
          ? 'bg-slate-200 text-slate-900 dark:bg-slate-700 dark:text-slate-100'
          : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
        disabled && 'pointer-events-none opacity-40',
      )}
    >
      {children}
    </button>
  )
}

function headingValue(editor: Editor): string {
  if (!editor) return 'paragraph'
  for (let level = 1; level <= 3; level++) {
    if (editor.isActive('heading', { level })) return String(level)
  }
  return 'paragraph'
}

export function KnowledgeDocumentEditor({
  docKey,
  initialRaw,
  onSave,
  onCancel,
  saveBusy,
}: KnowledgeDocumentEditorProps) {
  const parsed = useMemo(() => parseKbDocument(initialRaw), [initialRaw])
  const [title, setTitle] = useState(parsed.title)
  const [tagsText, setTagsText] = useState(parsed.tags.join(', '))
  const [helpOpen, setHelpOpen] = useState(false)
  const [, bumpToolbar] = useReducer((x: number) => x + 1, 0)

  const initialHtml = useMemo(() => markdownToHtml(parsed.bodyMd || ''), [parsed.bodyMd])

  const editor = useEditor(
    {
      immediatelyRender: false,
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3] },
        }),
        Underline,
        Link.configure({ openOnClick: false, autolink: true }),
        Placeholder.configure({
          placeholder: '请输入正文，「Ctrl+/」快速呼出写作帮助',
        }),
        TextAlign.configure({ types: ['heading', 'paragraph'] }),
        TextStyle,
        Color,
        Highlight.configure({ multicolor: true }),
        Image.configure({ inline: false, allowBase64: false }),
        Table.configure({ resizable: false }),
        TableRow,
        TableHeader,
        TableCell,
      ],
      content: initialHtml,
      editorProps: {
        attributes: {
          class: 'kb-rich-editor-prose focus:outline-none min-h-[420px] max-w-3xl mx-auto px-1 py-2 text-[15px] leading-relaxed text-slate-800 dark:text-slate-100',
        },
      },
      onUpdate: () => bumpToolbar(),
      onSelectionUpdate: () => bumpToolbar(),
    },
    [docKey],
  )

  useEffect(() => {
    const p = parseKbDocument(initialRaw)
    setTitle(p.title)
    setTagsText(p.tags.join(', '))
    if (editor) {
      const html = markdownToHtml(p.bodyMd || '')
      editor.commands.setContent(html)
    }
  }, [docKey, initialRaw, editor])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === '/') {
        e.preventDefault()
        setHelpOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const buildParts = useCallback((): KbDocParts => {
    const tags = tagsText
      .split(/[,，]/)
      .map((t) => t.trim())
      .filter(Boolean)
    const bodyMd = editor ? htmlToMarkdown(editor.getHTML()) : ''
    return {
      title: title.trim() || '未命名',
      tags,
      bodyMd,
    }
  }, [editor, tagsText, title])

  const handleSave = async () => {
    const raw = serializeKbDocument(buildParts())
    await onSave(raw)
  }

  const run = (fn: () => void) => {
    fn()
    bumpToolbar()
  }

  if (!editor) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-sm text-slate-500">
        编辑器加载中…
      </div>
    )
  }

  const charCount = editor.getText().length

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white dark:bg-slate-950">
      <div className="sticky top-0 z-20 flex flex-wrap items-center gap-0.5 border-b border-slate-200/90 bg-white/95 px-2 py-1.5 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95">
        <div className="mr-1 flex items-center gap-0.5 border-r border-slate-200 pr-1 dark:border-slate-700">
          <ToolbarButton title="撤销" onClick={() => run(() => editor.chain().focus().undo().run())}>
            <Undo2 className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton title="重做" onClick={() => run(() => editor.chain().focus().redo().run())}>
            <Redo2 className="h-4 w-4" />
          </ToolbarButton>
        </div>

        <div className="mr-1 flex items-center gap-0.5 border-r border-slate-200 pr-1 dark:border-slate-700">
          <span className="px-1 text-xs text-slate-500">插入</span>
          <ToolbarButton
            title="图片"
            onClick={() => {
              const src = window.prompt('图片 URL 或相对路径（相对当前 .md），例如 ./assets/x.png')
              if (src?.trim()) run(() => editor.chain().focus().setImage({ src: src.trim() }).run())
            }}
          >
            <ImageIcon className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            title="表格"
            onClick={() =>
              run(() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run())
            }
          >
            <Table2 className="h-4 w-4" />
          </ToolbarButton>
        </div>

        <div className="mr-1 flex items-center gap-0.5 border-r border-slate-200 pr-1 dark:border-slate-700">
          <ToolbarButton
            title="粗体"
            active={editor.isActive('bold')}
            onClick={() => run(() => editor.chain().focus().toggleBold().run())}
          >
            <Bold className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            title="斜体"
            active={editor.isActive('italic')}
            onClick={() => run(() => editor.chain().focus().toggleItalic().run())}
          >
            <Italic className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            title="下划线"
            active={editor.isActive('underline')}
            onClick={() => run(() => editor.chain().focus().toggleUnderline().run())}
          >
            <UnderlineIcon className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            title="删除线"
            active={editor.isActive('strike')}
            onClick={() => run(() => editor.chain().focus().toggleStrike().run())}
          >
            <Strikethrough className="h-4 w-4" />
          </ToolbarButton>
        </div>

        <div className="mr-1 flex items-center gap-1 border-r border-slate-200 pr-1 dark:border-slate-700">
          <input
            type="color"
            title="文字颜色"
            className="h-7 w-8 cursor-pointer overflow-hidden rounded border border-slate-200 bg-transparent p-0 dark:border-slate-600"
            onChange={(e) => run(() => editor.chain().focus().setColor(e.target.value).run())}
          />
          <input
            type="color"
            title="高亮"
            className="h-7 w-8 cursor-pointer overflow-hidden rounded border border-slate-200 bg-transparent p-0 dark:border-slate-600"
            defaultValue="#fef08a"
            onChange={(e) => run(() => editor.chain().focus().toggleHighlight({ color: e.target.value }).run())}
          />
        </div>

        <div className="mr-1 flex items-center gap-0.5 border-r border-slate-200 pr-1 dark:border-slate-700">
          <Heading1 className="ml-1 h-3.5 w-3.5 text-slate-400" />
          <select
            className="h-8 max-w-[120px] rounded-md border border-slate-200 bg-white px-1 text-xs text-slate-800 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            value={headingValue(editor)}
            onChange={(e) => {
              const v = e.target.value
              run(() => {
                if (v === 'paragraph') editor.chain().focus().setParagraph().run()
                else
                  editor
                    .chain()
                    .focus()
                    .toggleHeading({ level: Number(v) as 1 | 2 | 3 })
                    .run()
              })
            }}
          >
            <option value="paragraph">正文</option>
            <option value="1">标题 1</option>
            <option value="2">标题 2</option>
            <option value="3">标题 3</option>
          </select>
        </div>

        <div className="mr-1 flex items-center gap-0.5 border-r border-slate-200 pr-1 dark:border-slate-700">
          <ToolbarButton
            title="左对齐"
            active={editor.isActive({ textAlign: 'left' })}
            onClick={() => run(() => editor.chain().focus().setTextAlign('left').run())}
          >
            <AlignLeft className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            title="居中"
            active={editor.isActive({ textAlign: 'center' })}
            onClick={() => run(() => editor.chain().focus().setTextAlign('center').run())}
          >
            <AlignCenter className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            title="右对齐"
            active={editor.isActive({ textAlign: 'right' })}
            onClick={() => run(() => editor.chain().focus().setTextAlign('right').run())}
          >
            <AlignRight className="h-4 w-4" />
          </ToolbarButton>
        </div>

        <div className="mr-1 flex items-center gap-0.5 border-r border-slate-200 pr-1 dark:border-slate-700">
          <ToolbarButton
            title="无序列表"
            active={editor.isActive('bulletList')}
            onClick={() => run(() => editor.chain().focus().toggleBulletList().run())}
          >
            <List className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            title="有序列表"
            active={editor.isActive('orderedList')}
            onClick={() => run(() => editor.chain().focus().toggleOrderedList().run())}
          >
            <ListOrdered className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            title="引用"
            active={editor.isActive('blockquote')}
            onClick={() => run(() => editor.chain().focus().toggleBlockquote().run())}
          >
            <Quote className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            title="代码块"
            active={editor.isActive('codeBlock')}
            onClick={() => run(() => editor.chain().focus().toggleCodeBlock().run())}
          >
            <Code className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            title="分割线"
            onClick={() => run(() => editor.chain().focus().setHorizontalRule().run())}
          >
            <Minus className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            title="链接"
            onClick={() => {
              const prev = editor.getAttributes('link').href as string | undefined
              const href = window.prompt('链接地址', prev ?? 'https://')
              if (href === null) return
              if (href === '') {
                run(() => editor.chain().focus().unsetLink().run())
                return
              }
              run(() => editor.chain().focus().extendMarkRange('link').setLink({ href }).run())
            }}
          >
            <Link2 className="h-4 w-4" />
          </ToolbarButton>
        </div>

        <div className="ml-auto flex items-center gap-1 pl-1">
          <Button
            type="button"
            size="sm"
            className="gap-1 bg-violet-600 text-xs text-white hover:bg-violet-500 dark:bg-violet-600"
            onClick={() =>
              window.alert('请在正文里用鼠标选中一段文字，即可在上方出现「帮写、翻译、解读」工具栏；可先填写补充说明再发送。')
            }
          >
            <Sparkles className="h-3.5 w-3.5" />
            划词 AI
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1 text-xs"
            onClick={() => setHelpOpen((v) => !v)}
          >
            <HelpCircle className="h-3.5 w-3.5" />
            写作帮助
          </Button>
          <Button type="button" variant="outline" size="sm" className="text-xs" onClick={onCancel} disabled={saveBusy}>
            取消
          </Button>
          <Button type="button" size="sm" className="text-xs" onClick={() => void handleSave()} disabled={saveBusy}>
            {saveBusy ? '保存中…' : '保存'}
          </Button>
        </div>
      </div>

      {helpOpen ? (
        <div className="border-b border-violet-200 bg-violet-50 px-4 py-2 text-xs text-violet-900 dark:border-violet-900 dark:bg-violet-950/60 dark:text-violet-100">
          <p className="font-medium">快捷键与提示</p>
          <ul className="mt-1 list-inside list-disc space-y-0.5 text-violet-800/90 dark:text-violet-200/90">
            <li>
              <kbd className="rounded bg-white/80 px-1 dark:bg-slate-800">Ctrl+/</kbd> 打开或关闭本帮助
            </li>
            <li>使用工具栏设置标题、列表、表格与对齐方式；图片支持相对路径以便与知识库内资源一致。</li>
            <li>在正文中选中文字可弹出「帮写 / 翻译 / 解读」浮层，可补充说明后点击发送，再使用当前模型生成内容。</li>
          </ul>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/80 dark:bg-slate-900/50">
        <div className="mx-auto max-w-3xl px-6 pb-4 pt-8">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="请输入标题"
            className="mb-4 w-full border-0 bg-transparent text-3xl font-semibold tracking-tight text-slate-400 placeholder:text-slate-300 focus:outline-none focus:ring-0 dark:text-slate-100 dark:placeholder:text-slate-600"
          />
          <input
            type="text"
            value={tagsText}
            onChange={(e) => setTagsText(e.target.value)}
            placeholder="标签（逗号分隔，写入 frontmatter）"
            className="mb-6 w-full border-0 border-b border-transparent bg-transparent text-sm text-slate-600 placeholder:text-slate-400 focus:border-slate-200 focus:outline-none dark:text-slate-300 dark:focus:border-slate-600"
          />
          <div className="relative">
            <EditorContent editor={editor} />
            <KnowledgeSelectionAi editor={editor} />
          </div>
        </div>
      </div>

      <div className="flex items-center justify-end border-t border-slate-200 bg-white px-4 py-1.5 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
        <span>{charCount} 字</span>
      </div>
    </div>
  )
}
