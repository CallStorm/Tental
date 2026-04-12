import type { ComponentType } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { NavLink } from 'react-router-dom'
import { useAppPreferences } from '@/contexts/app-preferences'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import type { ChatSkinId } from '@/lib/chat-ui-skins'
import {
  Bot,
  Boxes,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ClipboardCheck,
  Hammer,
  Library,
  MessageSquare,
  Heart,
  Palette,
  PawPrint,
  Settings,
  Sparkles,
  Workflow,
} from 'lucide-react'

const navItems = [
  { to: '/chat', icon: MessageSquare, label: '聊天' },
  { to: '/evaluation', icon: ClipboardCheck, label: '测评' },
  { to: '/knowledge', icon: Library, label: '知识库' },
  { to: '/workflow', icon: Workflow, label: '工作流' },
  { to: '/tasks', icon: Clock3, label: '定时任务' },
  { to: '/mcp', icon: Bot, label: 'MCP' },
  { to: '/tools', icon: Hammer, label: '工具' },
  { to: '/skills', icon: Sparkles, label: '技能' },
  { to: '/profile', icon: Boxes, label: '个性配置' },
]

function NavItem({
  to,
  label,
  collapsed,
  Icon,
}: {
  to: string
  label: string
  collapsed: boolean
  Icon: ComponentType<{ className?: string }>
}) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          'skin-nav-link group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition',
          isActive
            ? 'skin-nav-link-active bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
            : 'skin-nav-link-idle text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-800',
        )
      }
    >
      <Icon className="h-4 w-4 shrink-0" />
      {!collapsed && <span className="truncate">{label}</span>}
    </NavLink>
  )
}

const skinChoices: { id: ChatSkinId; icon: ComponentType<{ className?: string }> }[] =
  [
    { id: 'default', icon: Palette },
    { id: 'animal-world', icon: PawPrint },
    { id: 'elegant', icon: Heart },
  ]

function skinChoiceLabel(t: (key: string) => string, id: ChatSkinId): string {
  const keys: Record<ChatSkinId, string> = {
    default: 'sidebar.skin.default',
    'animal-world': 'sidebar.skin.animalWorld',
    elegant: 'sidebar.skin.elegant',
  }
  return t(keys[id])
}

export function SidebarNav() {
  const { t } = useTranslation()
  const { chatSkin, setChatSkin, ready } = useAppPreferences()
  const [collapsed, setCollapsed] = useState(false)
  const [skinPickerOpen, setSkinPickerOpen] = useState(false)
  const widthClass = collapsed ? 'w-[72px]' : 'w-[220px]'

  return (
    <aside
      className={`skin-sidebar ${widthClass} border-r border-slate-200 bg-white p-3 transition-all dark:border-slate-800 dark:bg-slate-900`}
    >
      <div className="flex h-full flex-col">
        <div className="mb-4 flex items-center justify-between">
          {!collapsed && <h1 className="text-sm font-semibold">Tental</h1>}
          <button
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-200 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            onClick={() => setCollapsed((value) => !value)}
            aria-label={collapsed ? '展开导航' : '折叠导航'}
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronLeft className="h-4 w-4" />
            )}
          </button>
        </div>

        <nav className="space-y-1">
          {navItems.map((item) => (
            <NavItem
              key={item.to}
              to={item.to}
              label={item.label}
              collapsed={collapsed}
              Icon={item.icon}
            />
          ))}
        </nav>

        <div className="mt-auto space-y-1 pt-4">
          <Popover open={skinPickerOpen} onOpenChange={setSkinPickerOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                disabled={!ready}
                aria-haspopup="dialog"
                aria-expanded={skinPickerOpen}
                aria-label={t('sidebar.skin.openPicker')}
                title={t('sidebar.skin.openPicker')}
                className={cn(
                  'skin-nav-link group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition',
                  'text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-800',
                  !ready && 'pointer-events-none opacity-50',
                )}
              >
                <Palette className="h-4 w-4 shrink-0" />
                {!collapsed && (
                  <span className="truncate">{t('sidebar.skin.title')}</span>
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent
              side="right"
              align="end"
              className="w-[min(100vw-2rem,16rem)] p-3"
              aria-label={t('sidebar.skin.pickerTitle')}
            >
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {t('sidebar.skin.pickerTitle')}
              </p>
              <div className="grid grid-cols-2 gap-2">
                {skinChoices.map(({ id, icon: Icon }) => {
                  const active = chatSkin === id
                  const label = skinChoiceLabel(t, id)
                  return (
                    <button
                      key={id}
                      type="button"
                      disabled={!ready}
                      title={label}
                      aria-label={label}
                      aria-pressed={active}
                      onClick={() => {
                        void setChatSkin(id)
                        setSkinPickerOpen(false)
                      }}
                      className={cn(
                        'flex flex-col items-center gap-1 rounded-lg border px-2 py-2 text-[11px] font-medium transition',
                        active
                          ? id === 'elegant'
                            ? 'border-stone-900 bg-rose-50 text-rose-950 dark:border-stone-700 dark:bg-rose-950/35 dark:text-rose-100'
                            : 'border-emerald-600 bg-emerald-50 text-emerald-900 dark:border-emerald-500 dark:bg-emerald-950/40 dark:text-emerald-100'
                          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-slate-800',
                        !ready && 'pointer-events-none opacity-50',
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="line-clamp-2 text-center leading-tight">
                        {label}
                      </span>
                    </button>
                  )
                })}
              </div>
            </PopoverContent>
          </Popover>

          <NavItem
            to="/settings"
            label="设置"
            collapsed={collapsed}
            Icon={Settings}
          />
        </div>
      </div>
    </aside>
  )
}
