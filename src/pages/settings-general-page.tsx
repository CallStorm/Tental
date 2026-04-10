import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import {
  defaultConfig,
  getTentalDir,
  loadConfig,
  saveConfig,
  type AppConfig,
} from '@/lib/tauri-config'
import type { ChatSkinId } from '@/lib/chat-ui-skins'
import { applyChatSkin } from '@/lib/chat-ui-skins'
import { applyTheme } from '@/lib/theme'

export function SettingsGeneralPage() {
  const { t, i18n } = useTranslation()
  const [config, setConfig] = useState<AppConfig>(defaultConfig)
  const [configDir, setConfigDir] = useState('')

  useEffect(() => {
    const setup = async () => {
      const savedConfig = await loadConfig()
      setConfig(savedConfig)
      applyTheme(savedConfig.theme)
      await i18n.changeLanguage(savedConfig.language)
      const path = await getTentalDir()
      setConfigDir(path)
    }
    void setup()
  }, [i18n])

  const updateConfig = async (next: AppConfig) => {
    setConfig(next)
    applyTheme(next.theme)
    applyChatSkin(next.chatUiSkin)
    await i18n.changeLanguage(next.language)
    await saveConfig(next)
  }

  const darkChecked = config.theme === 'dark'

  return (
    <section className="skin-page-card rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
      <h2 className="mb-6 text-2xl font-semibold">{t('settings.general.title')}</h2>

      <div className="space-y-5">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <label htmlFor="theme" className="font-medium">
            {t('settings.theme.label')}
          </label>
          <Select
            id="theme"
            className="md:w-56"
            value={config.theme}
            options={[
              { value: 'light', label: t('settings.theme.light') },
              { value: 'dark', label: t('settings.theme.dark') },
              { value: 'system', label: t('settings.theme.system') },
            ]}
            onChange={(event) =>
              void updateConfig({
                ...config,
                theme: event.target.value as AppConfig['theme'],
              })
            }
          />
        </div>

        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <label htmlFor="language" className="font-medium">
            {t('settings.language.label')}
          </label>
          <Select
            id="language"
            className="md:w-56"
            value={config.language}
            options={[
              { value: 'zh', label: t('settings.language.zh') },
              { value: 'en', label: t('settings.language.en') },
            ]}
            onChange={(event) =>
              void updateConfig({
                ...config,
                language: event.target.value as AppConfig['language'],
              })
            }
          />
        </div>

        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <span className="font-medium">{t('settings.theme.quickDark')}</span>
          <Switch
            checked={darkChecked}
            onChange={(event) =>
              void updateConfig({
                ...config,
                theme: event.target.checked ? 'dark' : 'light',
              })
            }
          />
        </div>

        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <label htmlFor="chatUiSkin" className="font-medium">
            {t('settings.chatSkin.label')}
          </label>
          <Select
            id="chatUiSkin"
            className="md:w-56"
            value={config.chatUiSkin}
            options={[
              { value: 'default', label: t('settings.chatSkin.default') },
              { value: 'imperial', label: t('settings.chatSkin.imperial') },
              { value: 'journey_west', label: t('settings.chatSkin.journeyWest') },
              {
                value: 'three_kingdoms',
                label: t('settings.chatSkin.threeKingdoms'),
              },
            ]}
            onChange={(event) => {
              const v = event.target.value as ChatSkinId
              void updateConfig({
                ...config,
                chatUiSkin: v,
                chatUiPersonaEnabled:
                  v === 'default' ? false : config.chatUiPersonaEnabled,
              })
            }}
          />
        </div>

        <div className="flex flex-col gap-3 rounded-lg border border-slate-200 p-4 dark:border-slate-700">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <span className="font-medium">{t('settings.chatSkin.persona.label')}</span>
            <Switch
              checked={
                config.chatUiSkin !== 'default' && config.chatUiPersonaEnabled
              }
              disabled={config.chatUiSkin === 'default'}
              onChange={(event) =>
                void updateConfig({
                  ...config,
                  chatUiPersonaEnabled: event.target.checked,
                })
              }
            />
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {t('settings.chatSkin.persona.hint')}
          </p>
        </div>

        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <span className="font-medium">{t('settings.storage.path')}</span>
          <code className="rounded-md bg-slate-100 px-3 py-2 text-xs dark:bg-slate-800">
            {configDir || '~/.tental'}
          </code>
        </div>
      </div>
    </section>
  )
}
