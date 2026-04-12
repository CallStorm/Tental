import { gfm } from 'turndown-plugin-gfm'
import { marked } from 'marked'
import TurndownService from 'turndown'

export type KbDocParts = {
  title: string
  tags: string[]
  bodyMd: string
}

function parseYamlScalar(s: string): string {
  const t = s.trim()
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1)
  }
  return t
}

/** Split YAML frontmatter (--- … ---) and parse title + tags (aligned with Rust kb parser). */
export function parseKbDocument(raw: string): KbDocParts {
  const text = raw.replace(/^\u{feff}/u, '')
  if (!text.startsWith('---')) {
    return { title: '', tags: [], bodyMd: text }
  }
  const lines = text.split(/\r?\n/)
  if (lines[0]?.trim() !== '---') {
    return { title: '', tags: [], bodyMd: text }
  }
  let end = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === '---') {
      end = i
      break
    }
  }
  if (end < 0) {
    return { title: '', tags: [], bodyMd: text }
  }
  const header = lines.slice(1, end).join('\n')
  const body = lines.slice(end + 1).join('\n').replace(/^\n+/, '')

  let title = ''
  const tags: string[] = []
  const hLines = header.split('\n')
  let i = 0
  while (i < hLines.length) {
    const line = hLines[i]
    const t = line.trim()
    if (t.startsWith('title:')) {
      title = parseYamlScalar(t.slice(6))
      i += 1
      continue
    }
    if (t.startsWith('tags:')) {
      const rest = t.slice(5).trim()
      if (rest.startsWith('[')) {
        const inner = rest.slice(1, rest.lastIndexOf(']'))
        for (const part of inner.split(',')) {
          const p = parseYamlScalar(part)
          if (p) tags.push(p)
        }
        i += 1
        continue
      }
      if (rest === '') {
        i += 1
        while (i < hLines.length) {
          const ln = hLines[i].trim()
          if (ln.startsWith('-')) {
            tags.push(parseYamlScalar(ln.slice(1)))
            i += 1
          } else if (ln === '') {
            i += 1
          } else {
            break
          }
        }
        continue
      }
    }
    i += 1
  }

  return { title, tags, bodyMd: body }
}

export function serializeKbDocument(parts: KbDocParts): string {
  const tagBlock =
    parts.tags.length > 0
      ? `tags:\n${parts.tags.map((t) => `  - ${JSON.stringify(t)}`).join('\n')}`
      : 'tags: []'

  const body = parts.bodyMd.replace(/^\n+/, '').trimEnd()
  return `---
title: ${JSON.stringify(parts.title)}
${tagBlock}
---

${body}
`
}

let turndownSingleton: TurndownService | null = null

function getTurndown(): TurndownService {
  if (!turndownSingleton) {
    turndownSingleton = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-',
      emDelimiter: '*',
    })
    turndownSingleton.use(gfm)
  }
  return turndownSingleton
}

export function htmlToMarkdown(html: string): string {
  return getTurndown().turndown(html).trim()
}

export function markdownToHtml(markdown: string): string {
  const res = marked.parse(markdown, { async: false })
  return typeof res === 'string' ? res : ''
}

/** Parent directory relative path for a file path under kbs (empty = root). */
export function parentRelPath(relPath: string): string {
  const i = relPath.replace(/\\/g, '/').lastIndexOf('/')
  return i < 0 ? '' : relPath.slice(0, i)
}

/** Join kbs-relative segments with '/'. */
export function joinKbRel(...parts: string[]): string {
  return parts
    .flatMap((p) => p.split('/'))
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s !== '.' && s !== '..')
    .join('/')
}
