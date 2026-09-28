import { describe, expect, it } from 'vitest'
import { htmlLanguage, inferSiteLocale } from '../../supabase/functions/_shared/siteLocale'

describe('inferSiteLocale', () => {
  it('defaults an unknown site to English / global', () => {
    expect(inferSiteLocale({ url: 'https://acme.com' })).toEqual({ language: 'en', market: 'global' })
  })

  it('prefers the site html lang over the domain', () => {
    expect(inferSiteLocale({ url: 'https://example-petshop.com', html: '<html lang="it-IT">' })).toEqual({
      language: 'it',
      market: 'IT',
    })
  })

  it('reads a language path prefix and a country TLD', () => {
    expect(inferSiteLocale({ url: 'https://www.example-gym.com/it' })).toEqual({ language: 'it', market: 'IT' })
    expect(inferSiteLocale({ url: 'acmegym.de' })).toEqual({ language: 'de', market: 'DE' })
    expect(inferSiteLocale({ url: 'https://shop.co.uk' })).toEqual({ language: 'en', market: 'global' })
    // .ch is multilingual: market from the TLD, language from the page (or English).
    expect(inferSiteLocale({ url: 'https://agape.ch' })).toEqual({ language: 'en', market: 'CH' })
  })

  it('lets explicit choices win and ignores unsupported values', () => {
    expect(inferSiteLocale({ url: 'https://acme.it', language: 'EN', market: 'us' })).toEqual({ language: 'en', market: 'US' })
    expect(inferSiteLocale({ url: 'https://acme.com', language: 'nl', market: 'mars' })).toEqual({ language: 'en', market: 'global' })
  })
})

describe('htmlLanguage', () => {
  it('falls back to og:locale and rejects unsupported languages', () => {
    expect(htmlLanguage('<meta property="og:locale" content="fr_FR">')).toBe('fr')
    expect(htmlLanguage('<html lang="nl">')).toBeNull()
  })
})
