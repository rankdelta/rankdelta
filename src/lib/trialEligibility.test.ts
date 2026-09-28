import { describe, it, expect } from 'vitest';
import { canStartTrial } from '../lib/trialEligibility';

describe('canStartTrial', () => {
  it('allows brand-new users with no subscription row', () => {
    expect(canStartTrial(null)).toBe(true);
    expect(canStartTrial(undefined)).toBe(true);
  });

  it('allows incomplete accounts that never checked out', () => {
    expect(
      canStartTrial({
        trial_start: null,
        stripe_subscription_id: null,
        status: 'incomplete',
      }),
    ).toBe(true);
  });

  it('denies users who already used a trial', () => {
    expect(
      canStartTrial({
        trial_start: '2026-01-01T00:00:00Z',
        stripe_subscription_id: 'sub_123',
        status: 'canceled',
      }),
    ).toBe(false);
  });

  it('denies users with any Stripe subscription history', () => {
    expect(
      canStartTrial({
        trial_start: null,
        stripe_subscription_id: 'sub_paid',
        status: 'active',
      }),
    ).toBe(false);
  });

  it('denies billed statuses even without trial_start set', () => {
    for (const status of ['active', 'trialing', 'canceled', 'past_due', 'paused'] as const) {
      expect(
        canStartTrial({
          trial_start: null,
          stripe_subscription_id: null,
          status,
        }),
      ).toBe(false);
    }
  });
});
