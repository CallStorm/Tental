import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'

type SkillMarkdownPreviewProps = {
  source: string
  className?: string
}

/**
 * Remove Claude Skill / Hugo-style YAML frontmatter (first line `---` through next line `---` only).
 * Preview then shows only the Markdown body after the closing delimiter.
 */
export function stripSkillFrontmatter(source: string): string {
  const text = source.replace(/^\u{feff}/u, '')
  const lines = text.split(/\r?\n/)
  if (lines.length < 2 || lines[0]?.trim() !== '---') {
    return source
  }
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === '---') {
      const body = lines.slice(i + 1).join('\n').replace(/^\n+/, '')
      return body
    }
  }
  return source
}

/**
 * Markdown preview for SKILL.md content: high-contrast code blocks and readable GFM tables.
 */
export function SkillMarkdownPreview({ source, className }: SkillMarkdownPreviewProps) {
  const body = stripSkillFrontmatter(source)
  return (
    <div className={cn('skill-md-preview', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
    </div>
  )
}
