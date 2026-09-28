import { describe, it, expect, vi, beforeEach } from 'vitest'

const { authGetUserMock, getCapturedInsert, setCapturedInsert } = vi.hoisted(() => {
  let capturedInsert: Record<string, unknown> | null = null
  return {
    authGetUserMock: vi.fn(),
    getCapturedInsert: () => capturedInsert,
    setCapturedInsert: (value: Record<string, unknown> | null) => {
      capturedInsert = value
    },
  }
})

vi.mock('../lib/supabaseClient', () => ({
  supabase: {
    auth: { getUser: authGetUserMock },
    from: () => ({
      insert: (payload: Record<string, unknown>) => {
        setCapturedInsert(payload)
        return {
          select: () => ({
            single: () =>
              Promise.resolve({
                data: {
                  id: 'tpl-1',
                  user_id: payload['user_id'],
                  project_id: payload['project_id'],
                  name: payload['name'],
                  description: payload['description'],
                  layout: payload['layout'],
                  is_default: payload['is_default'],
                  created_at: '2026-01-01T00:00:00Z',
                  updated_at: '2026-01-01T00:00:00Z',
                },
                error: null,
              }),
          }),
        }
      },
    }),
  },
}))

import { saveReportTemplate } from './reportTemplates'

describe('saveReportTemplate', () => {
  beforeEach(() => {
    setCapturedInsert(null)
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } } })
  })

  it('sends project_id null when projectId is empty string', async () => {
    await saveReportTemplate({
      name: 'Agency default',
      layout: { version: 1, columns: 12, widgets: [] },
      projectId: '',
    })

    const row = getCapturedInsert()
    expect(row).not.toBeNull()
    expect(row!['project_id']).toBeNull()
    expect(row!['project_id']).not.toBe('')
  })

  it('preserves a real project id when provided', async () => {
    await saveReportTemplate({
      name: 'Client layout',
      layout: { version: 1, columns: 12, widgets: [] },
      projectId: '550e8400-e29b-41d4-a716-446655440000',
    })

    expect(getCapturedInsert()!['project_id']).toBe('550e8400-e29b-41d4-a716-446655440000')
  })
})
