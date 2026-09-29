import { describe, expect, it } from 'vitest'
import { visibilityGenerateErrorMessage } from './visibilityErrorMessage'

const t = (key: string) => key

describe('visibilityGenerateErrorMessage', () => {
	it('never shows a server error code to the user', () => {
		expect(visibilityGenerateErrorMessage(t, new Error('query_generation_failed'))).toBe('visibility.generateErrorGeneric')
		expect(visibilityGenerateErrorMessage(t, new Error('keywords_load_failed'))).toBe('visibility.generateErrorGeneric')
	})

	it('keeps a short human-readable message', () => {
		expect(visibilityGenerateErrorMessage(t, new Error('Add at least one keyword first.'))).toBe('Add at least one keyword first.')
	})

	it('falls back to the generic message for the SDK non-2xx text', () => {
		expect(visibilityGenerateErrorMessage(t, new Error('Edge Function returned a non-2xx status code'))).toBe('visibility.generateErrorGeneric')
	})
})
