import type { VisibilityQueryRunRow } from '../types/database';

/** User-facing setup lifecycle for AI Visibility. */
export type VisibilitySetupPhase = 'empty' | 'configured' | 'pending_data' | 'measured';

export function countCompletedRuns(runs: VisibilityQueryRunRow[]): number {
	return runs.filter((r) => r.status === 'completed').length;
}

/**
 * Derive where the user is in the guided setup flow.
 * - empty: no tracking questions yet
 * - configured: questions exist but no check has been attempted
 * - pending_data: checks started but none completed yet
 * - measured: at least one completed check
 */
export function resolveVisibilitySetupPhase(
	queryCount: number,
	runs: VisibilityQueryRunRow[],
): VisibilitySetupPhase {
	if (queryCount === 0) return 'empty';
	if (runs.length === 0) return 'configured';
	if (countCompletedRuns(runs) === 0) return 'pending_data';
	return 'measured';
}

export function visibilitySetupStepIndex(phase: VisibilitySetupPhase): number {
	switch (phase) {
		case 'empty':
			return 1;
		case 'configured':
			return 2;
		case 'pending_data':
			return 3;
		case 'measured':
			return 4;
	}
}
