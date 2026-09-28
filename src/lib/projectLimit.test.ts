import { describe, expect, it } from 'vitest';
import { resolveProjectLimit, UNLIMITED_PROJECTS } from './projectLimit';

describe('resolveProjectLimit', () => {
  it('uses the plan cap when the subscription row is stale (agency row copied as 1)', () => {
    expect(resolveProjectLimit({ subscriptionMax: 1, planMax: UNLIMITED_PROJECTS })).toBe(UNLIMITED_PROJECTS);
    expect(resolveProjectLimit({ subscriptionMax: 1, planMax: 10 })).toBe(10);
  });

  it('lets a per-account override widen but never narrow the plan cap', () => {
    expect(resolveProjectLimit({ subscriptionMax: 25, planMax: 10 })).toBe(25);
    expect(resolveProjectLimit({ subscriptionMax: 3, planMax: 10 })).toBe(10);
    expect(resolveProjectLimit({ subscriptionMax: UNLIMITED_PROJECTS, planMax: 3 })).toBe(UNLIMITED_PROJECTS);
  });

  it('never caps internal accounts', () => {
    expect(resolveProjectLimit({ subscriptionMax: 1, planMax: 1, isInternal: true })).toBe(UNLIMITED_PROJECTS);
  });

  it('falls back to a single project when nothing is known', () => {
    expect(resolveProjectLimit({})).toBe(1);
    expect(resolveProjectLimit({ subscriptionMax: null, planMax: null })).toBe(1);
    expect(resolveProjectLimit({ subscriptionMax: 0, planMax: undefined })).toBe(1);
  });
});
