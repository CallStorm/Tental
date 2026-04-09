import { invoke } from '@tauri-apps/api/core'

export type SkillMeta = {
  name: string
  description: string
  source: 'builtin' | 'custom' | string
  enabled: boolean
  updatedAt: number
  applicableChannels: string
}

export type ImportSkillsZipResult = {
  imported: string[]
}

export async function listSkills(): Promise<SkillMeta[]> {
  const res = await invoke<SkillMeta[]>('list_skills')
  return Array.isArray(res) ? res : []
}

export async function bootstrapBuiltinSkills(): Promise<void> {
  await invoke('bootstrap_builtin_skills')
}

export type SkillContentPayload = {
  name: string
  content: string
}

export async function getSkillContent(name: string): Promise<SkillContentPayload> {
  return invoke<SkillContentPayload>('get_skill_content', { req: { name } })
}

export async function saveSkillContent(payload: {
  name: string
  content: string
}): Promise<void> {
  await invoke('save_skill_content', {
    req: { name: payload.name, content: payload.content },
  })
}

export async function createSkill(payload: {
  name: string
  content: string
  config?: unknown
}): Promise<void> {
  await invoke('create_skill', {
    req: {
      name: payload.name.trim(),
      content: payload.content,
      config: payload.config ?? {},
    },
  })
}

export async function setSkillEnabled(name: string, enabled: boolean): Promise<void> {
  await invoke('set_skill_enabled', { req: { name, enabled } })
}

export async function deleteSkill(name: string): Promise<void> {
  await invoke('delete_skill', { req: { name } })
}

export async function importSkillsZipFromBase64(zipBase64: string): Promise<ImportSkillsZipResult> {
  return invoke<ImportSkillsZipResult>('import_skills_zip', {
    req: { zipBase64 },
  })
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const r = reader.result
      if (typeof r !== 'string') {
        reject(new Error('read failed'))
        return
      }
      const base64 = r.includes(',') ? r.split(',')[1] ?? '' : r
      resolve(base64)
    }
    reader.onerror = () => reject(reader.error ?? new Error('read error'))
    reader.readAsDataURL(file)
  })
}
