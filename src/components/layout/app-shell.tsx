import { Outlet } from 'react-router-dom'
import { SidebarNav } from '@/components/layout/sidebar-nav'

export function AppShell() {
  return (
    <div className="flex h-screen min-h-0 overflow-hidden bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <SidebarNav />
      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto p-6 md:p-8">
        <Outlet />
      </main>
    </div>
  )
}
