import { describe, expect, it } from 'vitest';
import { resolveVisibilitySetupPhase } from './visibilitySetupPhase';
import type { VisibilityQueryRunRow } from '../types/database';

function run(status: VisibilityQueryRunRow['status']): VisibilityQueryRunRow {
	return { status } as VisibilityQueryRunRow;
}

describe('resolveVisibilitySetupPhase', () => {
	it('returns empty when there are no questions', () => {
		expect(resolveVisibilitySetupPhase(0, [])).toBe('empty');
	});

	it('returns configured when questions exist but no runs', () => {
		expect(resolveVisibilitySetupPhase(3, [])).toBe('configured');
	});

	it('returns pending_data when runs exist but none completed', () => {
		expect(resolveVisibilitySetupPhase(3, [run('failed'), run('running')])).toBe('pending_data');
	});

	it('returns measured when at least one run completed', () => {
		expect(resolveVisibilitySetupPhase(3, [run('failed'), run('completed')])).toBe('measured');
	});
});
