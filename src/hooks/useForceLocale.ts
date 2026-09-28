import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Force the app's i18n language for a locale-prefixed route (e.g. /it/login), the same way the
 * marketing pages force it from their URL locale. changeLanguage persists to localStorage via the
 * detector, so once an Italian visitor lands on any /it/* page the whole app stays Italian — they
 * never have to flip the language switcher again. Also sets <html lang> for a11y/SEO.
 */
export function useForceLocale(locale: 'en' | 'it') {
  const { i18n } = useTranslation()
  useEffect(() => {
    if (i18n.language !== locale) void i18n.changeLanguage(locale)
    if (typeof document !== 'undefined') document.documentElement.lang = locale
  }, [locale, i18n])
}
