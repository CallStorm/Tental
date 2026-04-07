import { useTranslation } from 'react-i18next'

export function SettingsPlaceholderPage({ title }: { title: string }) {
  const { t } = useTranslation()
  return (
    <section className="rounded-xl border border-dashed border-slate-300 bg-white p-6 dark:border-slate-700 dark:bg-slate-900">
      <h3 className="mb-2 text-xl font-semibold">{title}</h3>
      <p className="text-slate-600 dark:text-slate-300">{t('common.comingSoon')}</p>
    </section>
  )
}
