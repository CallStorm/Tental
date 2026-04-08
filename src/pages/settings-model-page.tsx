import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import {
  loadModelConfig,
  PRESETS,
  type ModelConfig,
  type ModelProvider,
  type ProviderType,
  saveModelConfig,
  testModelEndpoint,
} from '@/lib/model-config'

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `p-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function maskKey(): string {
  return '******'
}

function ProviderLogo({ type }: { type: ProviderType }) {
  return (
    <div
      className={cn(
        'flex h-11 w-11 shrink-0 items-center justify-center rounded-lg shadow-sm',
        type === 'minimax_cn'
          ? 'bg-gradient-to-br from-pink-400 via-orange-300 to-amber-400'
          : 'bg-gradient-to-br from-sky-500 to-indigo-600',
      )}
      aria-hidden
    >
      {type === 'minimax_cn' ? (
        <span className="flex gap-0.5">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="block h-5 w-0.5 rounded-full bg-white/90"
              style={{ transform: `scaleY(${0.65 + i * 0.12})` }}
            />
          ))}
        </span>
      ) : (
        <span className="text-xs font-bold text-white">DS</span>
      )}
    </div>
  )
}

export function SettingsModelPage() {
  const { t } = useTranslation()
  const [config, setConfig] = useState<ModelConfig>({ defaultProviderId: null, providers: [] })
  const [modalOpen, setModalOpen] = useState(false)
  const [draftType, setDraftType] = useState<ProviderType>('minimax_cn')
  const [draftKey, setDraftKey] = useState('')
  const [draftModel, setDraftModel] = useState(PRESETS.minimax_cn.models[0].value)
  const [testBusy, setTestBusy] = useState<'connection' | 'multimodal' | null>(null)
  const [testHint, setTestHint] = useState<string | null>(null)

  const preset = PRESETS[draftType]

  useEffect(() => {
    void loadModelConfig().then(setConfig)
  }, [])

  const persist = useCallback(async (next: ModelConfig) => {
    setConfig(next)
    await saveModelConfig(next)
  }, [])

  const openAdd = () => {
    setDraftType('minimax_cn')
    setDraftKey('')
    setDraftModel(PRESETS.minimax_cn.models[0].value)
    setTestHint(null)
    setModalOpen(true)
  }

  const onDraftTypeChange = (type: ProviderType) => {
    setDraftType(type)
    setDraftModel(PRESETS[type].models[0].value)
    setTestHint(null)
  }

  const runTest = async (kind: 'connection' | 'multimodal') => {
    setTestBusy(kind)
    setTestHint(null)
    try {
      const msg = await testModelEndpoint({
        providerType: draftType,
        baseUrl: preset.baseUrl,
        apiKey: draftKey,
        model: draftModel,
        testKind: kind,
      })
      setTestHint(msg)
    } catch (e) {
      setTestHint(e instanceof Error ? e.message : String(e))
    } finally {
      setTestBusy(null)
    }
  }

  const saveDraft = async () => {
    const key = draftKey.trim()
    if (!key) return

    const entry: ModelProvider = {
      id: newId(),
      providerType: draftType,
      apiKey: key,
      model: draftModel,
      baseUrl: preset.baseUrl,
    }

    const nextProviders = [...config.providers, entry]
    const nextDefault =
      config.defaultProviderId ?? (nextProviders.length === 1 ? entry.id : config.defaultProviderId)

    await persist({
      defaultProviderId: nextDefault,
      providers: nextProviders,
    })
    setModalOpen(false)
  }

  const removeProvider = async (id: string) => {
    const nextProviders = config.providers.filter((p) => p.id !== id)
    let nextDefault = config.defaultProviderId
    if (nextDefault === id) {
      nextDefault = nextProviders[0]?.id ?? null
    }
    await persist({ defaultProviderId: nextDefault, providers: nextProviders })
  }

  const setDefaultProvider = async (id: string) => {
    if (config.defaultProviderId === id) return
    await persist({ ...config, defaultProviderId: id })
  }

  const providerLabel = useCallback(
    (p: ModelProvider) => {
      const pt = p.providerType === 'deepseek' || p.providerType === 'minimax_cn' ? p.providerType : null
      if (!pt) return p.providerType
      return t(`settings.model.provider.${pt}`)
    },
    [t],
  )

  const modelLabel = (p: ModelProvider) => {
    const pt = p.providerType === 'deepseek' || p.providerType === 'minimax_cn' ? p.providerType : null
    if (!pt) return p.model
    const found = PRESETS[pt].models.find((m) => m.value === p.model)
    return found?.label ?? p.model
  }

  const providerOptions = useMemo(
    () =>
      (['minimax_cn', 'deepseek'] as ProviderType[]).map((value) => ({
        value,
        label: t(`settings.model.provider.${value}`),
      })),
    [t],
  )

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-2xl font-semibold">{t('settings.model.title')}</h2>
        <Button type="button" className="shrink-0 gap-1.5" onClick={openAdd}>
          <Plus className="h-4 w-4" />
          {t('settings.model.add')}
        </Button>
      </div>

      {config.providers.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50/80 px-4 py-8 text-center text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-400">
          {t('settings.model.empty')}
        </p>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {config.providers.map((p) => {
            const pt = p.providerType === 'deepseek' || p.providerType === 'minimax_cn' ? p.providerType : 'minimax_cn'
            const isDefault = config.defaultProviderId === p.id
            return (
              <li
                key={p.id}
                className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-md ring-1 ring-black/5 dark:border-slate-700 dark:bg-slate-900 dark:ring-white/5"
              >
                <div className="flex gap-3">
                  <ProviderLogo type={pt} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-lg font-bold text-slate-900 dark:text-slate-50">
                        {providerLabel(p)}
                      </h3>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                        {t('settings.model.builtIn')}
                      </span>
                      {isDefault ? (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                          {t('settings.model.defaultBadge')}
                        </span>
                      ) : null}
                    </div>

                    <dl className="mt-3 space-y-2 text-sm">
                      <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
                        <dt className="shrink-0 text-slate-500 dark:text-slate-400">
                          {t('settings.model.baseUrl')}
                        </dt>
                        <dd className="min-w-0 break-all font-mono text-xs text-slate-900 dark:text-slate-100">
                          {p.baseUrl}
                        </dd>
                      </div>
                      <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
                        <dt className="shrink-0 text-slate-500 dark:text-slate-400">
                          {t('settings.model.apiKey')}
                        </dt>
                        <dd className="font-mono text-slate-900 dark:text-slate-100">{maskKey()}</dd>
                      </div>
                      <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-2 sm:items-baseline">
                        <dt className="shrink-0 text-slate-500 dark:text-slate-400">{t('settings.model.model')}</dt>
                        <dd className="text-base font-medium text-red-600 dark:text-red-400">{modelLabel(p)}</dd>
                      </div>
                    </dl>

                    <div className="mt-4 flex flex-wrap gap-2">
                      {!isDefault ? (
                        <Button type="button" variant="outline" size="sm" onClick={() => void setDefaultProvider(p.id)}>
                          {t('settings.model.setDefault')}
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-1 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                        onClick={() => void removeProvider(p.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        {t('settings.model.remove')}
                      </Button>
                    </div>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {modalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-[1px]"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setModalOpen(false)
          }}
        >
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
            role="dialog"
            aria-modal
            aria-labelledby="model-add-title"
          >
            <h3 id="model-add-title" className="text-lg font-semibold">
              {t('settings.model.addTitle')}
            </h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('settings.model.addHint')}</p>

            <div className="mt-5 space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="provider-type">
                  {t('settings.model.pickProvider')}
                </label>
                <Select
                  id="provider-type"
                  value={draftType}
                  options={providerOptions}
                  onChange={(e) => onDraftTypeChange(e.target.value as ProviderType)}
                />
              </div>

              <div className="space-y-1.5">
                <span className="text-sm font-medium">{t('settings.model.baseUrl')}</span>
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200">
                  {preset.baseUrl}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="api-key">
                  {t('settings.model.apiKey')}
                </label>
                <input
                  id="api-key"
                  type="password"
                  autoComplete="off"
                  value={draftKey}
                  onChange={(e) => setDraftKey(e.target.value)}
                  className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none ring-offset-white focus-visible:ring-2 focus-visible:ring-slate-400 dark:border-slate-700 dark:bg-slate-950 dark:ring-offset-slate-950"
                  placeholder={t('settings.model.apiKeyPlaceholder')}
                />
              </div>

              <div className="space-y-2">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <label className="text-sm font-medium" htmlFor="model-select">
                      {t('settings.model.model')}
                    </label>
                    <Select
                      id="model-select"
                      value={draftModel}
                      options={preset.models.map((m) => ({ value: m.value, label: m.label }))}
                      onChange={(e) => setDraftModel(e.target.value)}
                    />
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2 sm:pb-0">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!!testBusy}
                      onClick={() => void runTest('multimodal')}
                    >
                      {testBusy === 'multimodal' ? t('settings.model.testing') : t('settings.model.testMultimodal')}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!!testBusy}
                      onClick={() => void runTest('connection')}
                    >
                      {testBusy === 'connection' ? t('settings.model.testing') : t('settings.model.testConnection')}
                    </Button>
                  </div>
                </div>
                {testHint ? (
                  <p className="text-xs text-slate-600 dark:text-slate-400">{testHint}</p>
                ) : null}
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
              <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>
                {t('settings.model.cancel')}
              </Button>
              <Button type="button" disabled={!draftKey.trim()} onClick={() => void saveDraft()}>
                {t('settings.model.save')}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}
