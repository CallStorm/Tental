import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import enCommon from '@/i18n/locales/en/common.json'
import zhCommon from '@/i18n/locales/zh/common.json'

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: enCommon },
    zh: { translation: zhCommon },
  },
  lng: 'zh',
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false,
  },
})

export default i18n
