import { NavLink, Outlet } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

const settingsItems = [
  { to: '/settings/general', key: 'settings.nav.general' },
  { to: '/settings/model', key: 'settings.nav.model' },
  { to: '/settings/agent', key: 'settings.nav.agent' },
  { to: '/settings/advanced', key: 'settings.nav.advanced' },
]

export function SettingsLayoutPage() {
  const { t } = useTranslation()
  return (
    <section className="grid gap-6 lg:grid-cols-[220px_1fr]">
      <aside className="skin-settings-subnav rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="mb-3 px-2 text-sm font-semibold text-slate-500 dark:text-slate-400">
          {t('settings.title')}
        </h2>
        <nav className="space-y-1">
          {settingsItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  'skin-nav-link block rounded-md px-3 py-2 text-sm transition',
                  isActive
                    ? 'skin-nav-link-active bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                    : 'skin-nav-link-idle text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
                )
              }
            >
              {t(item.key)}
            </NavLink>
          ))}
        </nav>
      </aside>
      <Outlet />
    </section>
  )
}
