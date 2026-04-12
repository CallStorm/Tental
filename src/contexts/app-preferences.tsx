import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { applyChatSkin, type ChatSkinId } from '@/lib/chat-ui-skins'
import { applyTheme } from '@/lib/theme'
import { loadConfig, saveConfig } from '@/lib/tauri-config'

type AppPreferencesContextValue = {
  chatSkin: ChatSkinId
  setChatSkin: (id: ChatSkinId) => Promise<void>
  ready: boolean
}

const AppPreferencesContext = createContext<AppPreferencesContextValue | null>(
  null,
)

export function AppPreferencesProvider({ children }: { children: ReactNode }) {
  const [chatSkin, setChatSkinState] = useState<ChatSkinId>('default')
  const [ready, setReady] = useState(false)

  useEffect(() => {
    void loadConfig().then((c) => {
      applyTheme()
      applyChatSkin(c.chatSkin)
      setChatSkinState(c.chatSkin)
      setReady(true)
    })
  }, [])

  const setChatSkin = useCallback(async (id: ChatSkinId) => {
    setChatSkinState(id)
    applyChatSkin(id)
    const c = await loadConfig()
    await saveConfig({ ...c, chatSkin: id, theme: 'light' })
  }, [])

  return (
    <AppPreferencesContext.Provider value={{ chatSkin, setChatSkin, ready }}>
      {children}
    </AppPreferencesContext.Provider>
  )
}

export function useAppPreferences(): AppPreferencesContextValue {
  const ctx = useContext(AppPreferencesContext)
  if (!ctx) {
    throw new Error('useAppPreferences must be used within AppPreferencesProvider')
  }
  return ctx
}
