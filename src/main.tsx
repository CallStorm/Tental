import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import '@/i18n'
import './index.css'
import App from '@/App'
import { applyChatSkin } from '@/lib/chat-ui-skins'
import { applyTheme } from '@/lib/theme'

applyTheme()
applyChatSkin('default')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
