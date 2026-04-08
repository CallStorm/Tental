import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  defaultAgentConfig,
  loadConfig,
  saveConfig,
  type AgentConfig,
} from '@/lib/tauri-config'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, Math.round(value)))
}

export function SettingsAgentPage() {
  const { t } = useTranslation()
  const [agent, setAgent] = useState<AgentConfig>(defaultAgentConfig)

  useEffect(() => {
    void (async () => {
      const cfg = await loadConfig()
      setAgent(cfg.agent)
    })()
  }, [])

  const updateAgent = async (next: AgentConfig) => {
    const cfg = await loadConfig()
    setAgent(next)
    await saveConfig({ ...cfg, agent: next })
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
      <h2 className="mb-6 text-2xl font-semibold">{t('settings.agent.title')}</h2>

      <div className="space-y-6">
        <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
          <h3 className="mb-4 text-base font-semibold">{t('settings.agent.react.title')}</h3>
          <div className="space-y-4">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <label htmlFor="agent-language" className="font-medium">
                {t('settings.agent.language.label')}
              </label>
              <Select
                id="agent-language"
                className="md:w-56"
                value={agent.language}
                options={[
                  { value: 'zh', label: t('settings.agent.language.zh') },
                  { value: 'en', label: t('settings.agent.language.en') },
                ]}
                onChange={(e) =>
                  void updateAgent({
                    ...agent,
                    language: e.target.value as AgentConfig['language'],
                  })
                }
              />
            </div>

            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <label htmlFor="agent-max-iterations" className="font-medium">
                {t('settings.agent.maxIterations.label')}
              </label>
              <input
                id="agent-max-iterations"
                type="number"
                min={1}
                max={20}
                value={agent.maxIterations}
                onChange={(e) =>
                  setAgent((x) => ({
                    ...x,
                    maxIterations: clampInt(Number(e.target.value), 1, 20),
                  }))
                }
                onBlur={() => void updateAgent({ ...agent, maxIterations: clampInt(agent.maxIterations, 1, 20) })}
                className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm outline-none ring-offset-white focus-visible:ring-2 focus-visible:ring-slate-400 dark:border-slate-700 dark:bg-slate-950 dark:ring-offset-slate-950 md:w-56"
              />
            </div>

            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <label htmlFor="agent-max-context" className="font-medium">
                {t('settings.agent.maxContextTokens.label')}
              </label>
              <input
                id="agent-max-context"
                type="number"
                min={1000}
                max={128000}
                step={500}
                value={agent.maxContextTokens}
                onChange={(e) =>
                  setAgent((x) => ({
                    ...x,
                    maxContextTokens: clampInt(Number(e.target.value), 1000, 128000),
                  }))
                }
                onBlur={() =>
                  void updateAgent({
                    ...agent,
                    maxContextTokens: clampInt(agent.maxContextTokens, 1000, 128000),
                  })
                }
                className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm outline-none ring-offset-white focus-visible:ring-2 focus-visible:ring-slate-400 dark:border-slate-700 dark:bg-slate-950 dark:ring-offset-slate-950 md:w-56"
              />
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
          <h3 className="mb-4 text-base font-semibold">{t('settings.agent.retry.title')}</h3>
          <div className="space-y-4">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <span className="font-medium">{t('settings.agent.retry.enabled')}</span>
              <Switch
                checked={agent.autoRetryEnabled}
                onChange={(e) => void updateAgent({ ...agent, autoRetryEnabled: e.target.checked })}
              />
            </div>
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <label htmlFor="agent-max-retry" className="font-medium">
                {t('settings.agent.retry.maxRetryCount')}
              </label>
              <input
                id="agent-max-retry"
                type="number"
                min={0}
                max={10}
                value={agent.maxRetryCount}
                disabled={!agent.autoRetryEnabled}
                onChange={(e) =>
                  setAgent((x) => ({
                    ...x,
                    maxRetryCount: clampInt(Number(e.target.value), 0, 10),
                  }))
                }
                onBlur={() => void updateAgent({ ...agent, maxRetryCount: clampInt(agent.maxRetryCount, 0, 10) })}
                className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm outline-none ring-offset-white focus-visible:ring-2 focus-visible:ring-slate-400 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:ring-offset-slate-950 md:w-56"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

