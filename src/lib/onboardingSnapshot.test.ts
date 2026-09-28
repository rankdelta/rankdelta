import { describe, expect, it } from 'vitest'
import { readOnboardingSnapshot } from './onboardingSnapshot'
import type { Project } from '../types/database'

function project(metadata: Record<string, unknown> | null): Project {
  return {
    id: 'p',
    user_id: 'u',
    name: 'n',
    website_url: null,
    primary_keyword: null,
    main_topic: null,
    tone: 'n',
    content_length: 1,
    language: 'it',
    author_name: null,
    author_bio: null,
    author_expertise: null,
    metadata,
    created_at: '',
    updated_at: '',
  }
}

describe('readOnboardingSnapshot', () => {
  it('returns null when metadata is empty', () => {
    expect(readOnboardingSnapshot(project({}))).toBeNull()
    expect(readOnboardingSnapshot(project(null))).toBeNull()
  })

  it('parses a visibility aha without inventing SoV', () => {
    const snap = readOnboardingSnapshot(
      project({
        onboarding: {
          visibility: {
            brand: 'Pawly',
            query: 'best dog supplements',
            level: 'absent',
            cited: false,
            competitors: ['Zesty Paws'],
            at: '2026-08-24T00:00:00.000Z',
          },
        },
      }),
    )
    expect(snap?.visibility?.brand).toBe('Pawly')
    expect(snap?.visibility?.cited).toBe(false)
    expect(snap?.health).toBeUndefined()
  })

  it('parses health and gsc without treating them as 7-day SoV', () => {
    const snap = readOnboardingSnapshot(
      project({
        onboarding: {
          health: { compositeHealth: 72, geoReadinessScore: 40, at: '2026-08-24T00:00:00.000Z' },
          gsc: { property: 'sc-domain:example-petshop.com', clicks: 12, impressions: 400, at: '2026-08-24T00:00:00.000Z' },
        },
      }),
    )
    expect(snap?.health?.compositeHealth).toBe(72)
    expect(snap?.gsc?.property).toBe('sc-domain:example-petshop.com')
    expect(snap?.visibility).toBeUndefined()
  })

  it('ignores unrelated metadata keys', () => {
    expect(readOnboardingSnapshot(project({ sitemap: { pages: [] } }))).toBeNull()
  })
})
