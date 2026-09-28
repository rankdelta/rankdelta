/**
 * Report gating. The cloud keeps its plan rules; a self-hosted install has no plans, so reports,
 * white-label branding and the portfolio are always unlocked there (every sign-up gets a
 * 'starter'/'incomplete' subscription row, which has no white_label feature).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PlanConfiguration, Subscription } from '../../types/subscription'

const starterSub = { plan: 'starter', status: 'incomplete' } as unknown as Subscription
const starterPlan = { plan: 'starter', features: { rank_tracking: true } } as unknown as PlanConfiguration
const agencySub = { plan: 'agency', status: 'active' } as unknown as Subscription

async function load(selfHost: boolean) {
	vi.resetModules()
	vi.doMock('../../config/deployment', () => ({ requiresSubscription: () => !selfHost }))
	return import('./gating')
}

afterEach(() => {
	vi.doUnmock('../../config/deployment')
})

describe('report gating', () => {
	it('self-host: everything is unlocked, with or without a subscription row', async () => {
		const g = await load(true)
		expect(g.isProPlusPlan(null, null)).toBe(true)
		expect(g.isAgencyPlan(null, null)).toBe(true)
		expect(g.isAgencyPlan(starterSub, starterPlan)).toBe(true)
	})

	it('cloud: white-label and portfolio stay on the agency plan', async () => {
		const g = await load(false)
		expect(g.isAgencyPlan(starterSub, starterPlan)).toBe(false)
		expect(g.isAgencyPlan(null, null)).toBe(false)
		expect(g.isAgencyPlan(agencySub, null)).toBe(true)
	})

	it('cloud: the report builder keeps its current rule (plan or rank_tracking)', async () => {
		const g = await load(false)
		expect(g.isProPlusPlan(null, null)).toBe(false)
		expect(g.isProPlusPlan(agencySub, null)).toBe(true)
		expect(g.isProPlusPlan(starterSub, starterPlan)).toBe(true)
	})
})
