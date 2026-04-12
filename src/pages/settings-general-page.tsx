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
          <span className="font-medium">{t('settings.storage.path')}</span>
          <code className="rounded-md bg-slate-100 px-3 py-2 text-xs dark:bg-slate-800">
            {configDir || '~/.tental'}
          </code>
        </div>
      </div>
    </section>
  )
}
