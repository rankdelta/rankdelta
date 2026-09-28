import { describe, it, expect } from 'vitest'
import { matchGa4Property, type Ga4Property } from './googleAnalytics4'

describe('matchGa4Property', () => {
  const props: Ga4Property[] = [
    { propertyId: 'properties/111', displayName: 'Blog', defaultUri: 'https://blog.example.com' },
    { propertyId: 'properties/222', displayName: 'Main site', defaultUri: 'https://www.example.com' },
  ]

  it('returns first property when websiteUrl is missing', () => {
    expect(matchGa4Property(props, null)).toBe('properties/111')
  })

  it('matches by defaultUri hostname', () => {
    expect(matchGa4Property(props, 'https://example.com')).toBe('properties/222')
  })

  it('returns null for empty list', () => {
    expect(matchGa4Property([], 'https://example.com')).toBeNull()
  })
})
