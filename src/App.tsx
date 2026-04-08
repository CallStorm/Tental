import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from '@/components/layout/app-shell'
import { ComingSoonPage } from '@/pages/coming-soon-page'
import { SettingsGeneralPage } from '@/pages/settings-general-page'
import { SettingsLayoutPage } from '@/pages/settings-layout-page'
import { SettingsModelPage } from '@/pages/settings-model-page'
import { SettingsPlaceholderPage } from '@/pages/settings-placeholder-page'

function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Navigate to="/chat" replace />} />
        <Route path="/chat" element={<ComingSoonPage title="聊天" />} />
        <Route path="/knowledge" element={<ComingSoonPage title="知识库" />} />
        <Route path="/workflow" element={<ComingSoonPage title="工作流" />} />
        <Route path="/tasks" element={<ComingSoonPage title="定时任务" />} />
        <Route path="/mcp" element={<ComingSoonPage title="MCP" />} />
        <Route path="/tools" element={<ComingSoonPage title="工具" />} />
        <Route path="/skills" element={<ComingSoonPage title="技能" />} />
        <Route path="/profile" element={<ComingSoonPage title="个性配置" />} />
        <Route path="/settings" element={<SettingsLayoutPage />}>
          <Route index element={<Navigate to="/settings/general" replace />} />
          <Route path="general" element={<SettingsGeneralPage />} />
          <Route path="model" element={<SettingsModelPage />} />
          <Route
            path="advanced"
            element={<SettingsPlaceholderPage title="高级设置" />}
          />
        </Route>
      </Route>
    </Routes>
  )
}

export default App
