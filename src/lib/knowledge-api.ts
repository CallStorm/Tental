import { invoke } from '@tauri-apps/api/core'

export type KbTreeEntry = {
  kind: 'dir' | 'file'
  name: string
  relPath: string
  title?: string
  tags?: string[]
  children?: KbTreeEntry[]
}

export async function kbListTree(): Promise<KbTreeEntry[]> {
  const res = await invoke<KbTreeEntry[]>('kb_list_tree')
  return Array.isArray(res) ? res : []
}

export async function kbRead(relPath: string): Promise<string> {
  return invoke<string>('kb_read', { relPath })
}

export async function kbWrite(relPath: string, content: string): Promise<void> {
  await invoke('kb_write', { req: { relPath, content } })
}

export async function kbDelete(relPath: string): Promise<void> {
  await invoke('kb_delete', { relPath })
}

export async function kbRename(fromRelPath: string, toRelPath: string): Promise<void> {
  await invoke('kb_rename', { req: { fromRelPath, toRelPath } })
}

export async function kbMkdir(relPath: string): Promise<void> {
  await invoke('kb_mkdir', { relPath })
}

export type KbSearchHit = {
  relPath: string
  title: string
  snippet: string
  tags: string[]
}

export async function kbSearch(query: string | undefined, tags: string[]): Promise<KbSearchHit[]> {
  const q = query?.trim()
  const res = await invoke<KbSearchHit[]>('kb_search', {
    req: {
      query: q && q.length > 0 ? q : null,
      tags: tags.length ? tags : null,
    },
  })
  return Array.isArray(res) ? res : []
}

export async function kbResolveAssetPath(docRelPath: string, href: string): Promise<string> {
  return invoke<string>('kb_resolve_asset_path', { docRelPath, href })
}
