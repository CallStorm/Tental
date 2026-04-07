import type { ComponentType } from 'react'
import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import {
  Bot,
  Boxes,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Hammer,
  Library,
  MessageSquare,
  Settings,
  Sparkles,
  Workflow,
} from 'lucide-react'

const navItems = [
  { to: '/chat', icon: MessageSquare, label: '聊天' },
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
        `group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
          isActive
            ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
            : 'text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-800'
        }`
      }
    >
      <Icon className="h-4 w-4 shrink-0" />
      {!collapsed && <span className="truncate">{label}</span>}
    </NavLink>
  )
}

export function SidebarNav() {
  const [collapsed, setCollapsed] = useState(false)
  const widthClass = collapsed ? 'w-[72px]' : 'w-[220px]'

  return (
    <aside
      className={`${widthClass} border-r border-slate-200 bg-white p-3 transition-all dark:border-slate-800 dark:bg-slate-900`}
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

        <div className="mt-auto pt-4">
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
