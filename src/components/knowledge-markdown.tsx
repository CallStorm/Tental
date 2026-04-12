import { convertFileSrc } from '@tauri-apps/api/core'
import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Copy } from 'lucide-react'

import { stripSkillFrontmatter } from '@/components/skill-markdown-preview'
import { kbResolveAssetPath } from '@/lib/knowledge-api'
import { cn } from '@/lib/utils'

type KnowledgeMarkdownProps = {
  /** Raw markdown file contents (may include YAML frontmatter). */
  text: string
  /** Path of the `.md` file relative to the knowledge base root (forward slashes). */
  docRelPath: string
  className?: string
}

function flattenText(node: unknown): string {
  if (node == null) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(flattenText).join('')
  if (typeof node === 'object') {
    const anyNode = node as { props?: { children?: unknown } }
    return flattenText(anyNode.props?.children)
  }
  return ''
}

function CopyButton({ text }: { text: string }) {
  const onCopy = async () => {
    const t = text.trim()
    if (!t) return
    try {
      await navigator.clipboard.writeText(t)
    } catch {
      // no-op
    }
  }
  return (
    <button
      type="button"
      onClick={() => void onCopy()}
      className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md bg-white/80 px-2 py-1 text-xs text-slate-600 shadow-sm ring-1 ring-slate-200/70 backdrop-blur transition hover:bg-white dark:bg-slate-900/70 dark:text-slate-200 dark:ring-slate-700/80"
      aria-label="Copy code"
    >
      <Copy className="h-3.5 w-3.5" />
      Copy
    </button>
  )
}

function KbImage({
  docRelPath,
  src,
  alt,
  className,
}: {
  docRelPath: string
  src?: string
  alt?: string
  className?: string
}) {
  const [resolved, setResolved] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!src) {
      setResolved(null)
      setFailed(true)
      setLoading(false)
      return
    }
    if (/^(https?:|data:)/i.test(src)) {
      setResolved(src)
      setFailed(false)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setFailed(false)
    setResolved(null)
    void (async () => {
      try {
        const abs = await kbResolveAssetPath(docRelPath, src)
        if (cancelled) return
        setResolved(convertFileSrc(abs))
        setFailed(false)
      } catch {
        if (!cancelled) {
          setResolved(null)
          setFailed(true)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [docRelPath, src])

  if (!src) return null
  if (/^(https?:|data:)/i.test(src)) {
    return (
      <img
        src={src}
        alt={alt ?? ''}
        className={cn('my-2 max-h-[min(70vh,720px)] max-w-full rounded-lg object-contain', className)}
      />
    )
  }
  if (loading) {
    return (
      <span className="my-2 inline-block rounded border border-slate-200 bg-slate-50 px-2 py-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
        加载图片…
      </span>
    )
  }
  if (failed || resolved === null) {
    return (
      <span className="my-2 inline-block rounded border border-amber-200 bg-amber-50 px-2 py-1 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
        无法加载图片: {src}
      </span>
    )
  }
  return (
    <img
      src={resolved}
      alt={alt ?? ''}
      className={cn('my-2 max-h-[min(70vh,720px)] max-w-full rounded-lg object-contain', className)}
    />
  )
}

export function KnowledgeMarkdown({ text, docRelPath, className }: KnowledgeMarkdownProps) {
  const body = stripSkillFrontmatter(text)
  return (
    <div className={cn('chat-md kb-md max-w-none text-[0.9375rem] leading-relaxed', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
          ul: ({ children }) => (
            <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>
          ),
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          strong: ({ children }) => (
            <strong className="font-semibold">{children}</strong>
          ),
          code: ({ className: codeClass, children }) => {
            const isBlock = codeClass?.includes('language-')
            if (isBlock) {
              return <code className={codeClass}>{children}</code>
            }
            return (
              <code className="rounded bg-slate-100 px-1 py-0.5 text-[0.9em] dark:bg-slate-800">
                {children}
              </code>
            )
          },
          pre: ({ children }) => {
            const raw = flattenText(children)
            return (
              <div className="relative my-2">
                <CopyButton text={raw} />
                <pre className="overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-[0.9em] dark:border-slate-700 dark:bg-slate-800/80">
                  {children}
                </pre>
              </div>
            )
          },
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto">
              <table className="w-full border-collapse text-left text-[0.95em]">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-slate-50 dark:bg-slate-800/50">{children}</thead>
          ),
          tbody: ({ children }) => <tbody>{children}</tbody>,
          tr: ({ children }) => (
            <tr className="border-b border-slate-200 dark:border-slate-700">{children}</tr>
          ),
          th: ({ children }) => (
            <th className="border border-slate-200 px-3 py-2 font-semibold dark:border-slate-700">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-slate-200 px-3 py-2 align-top dark:border-slate-700">
              {children}
            </td>
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              className="font-medium text-violet-600 underline underline-offset-2 hover:text-violet-500 dark:text-violet-400"
            >
              {children}
            </a>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-2 border-l-2 border-slate-300 pl-3 text-slate-600 italic dark:border-slate-600 dark:text-slate-400">
              {children}
            </blockquote>
          ),
          img: ({ src, alt, className: imgClass }) => (
            <KbImage docRelPath={docRelPath} src={src} alt={alt ?? undefined} className={imgClass} />
          ),
        }}
      >
        {body}
      </ReactMarkdown>
    </div>
  )
}
