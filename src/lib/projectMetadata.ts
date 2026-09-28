/**
 * Typed reads/writes for `projects.metadata` fields used by visibility UX.
 * Callers must merge — never overwrite unrelated metadata keys.
 */

import { supabase } from './supabaseClient';
import type { Project } from '../types/database';
import {
	DEFAULT_VISIBILITY_PROVIDERS,
	type VisibilityRunProvider,
} from '../services/visibilityOps';

export type OnboardingGoal = 'ai' | 'competitor' | 'traffic';

const GOAL_KEY = 'goal';
const TARGET_COMPETITOR_KEY = 'target_competitor_id';
const ENGINES_KEY = 'engines_to_run';
const LOCALITY_KEY = 'locality';

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

export function readProjectGoal(project: Project | null | undefined): OnboardingGoal | null {
	const g = project?.metadata?.[GOAL_KEY];
	if (g === 'ai' || g === 'competitor' || g === 'traffic') return g;
	return null;
}

export function readProjectLocality(project: Project | null | undefined): string | null {
	const v = project?.metadata?.[LOCALITY_KEY];
	return typeof v === 'string' && v.trim() ? v.trim() : null;
}

export function readTargetCompetitorId(project: Project | null | undefined): string | null {
	const id = project?.metadata?.[TARGET_COMPETITOR_KEY];
	return typeof id === 'string' && id.trim() ? id : null;
}

export function readEnginesToRun(project: Project | null | undefined): VisibilityRunProvider[] {
	const raw = project?.metadata?.[ENGINES_KEY];
	if (!Array.isArray(raw)) return [...DEFAULT_VISIBILITY_PROVIDERS];
	const allowed = new Set<string>(DEFAULT_VISIBILITY_PROVIDERS);
	const picked = raw.filter((v): v is VisibilityRunProvider => typeof v === 'string' && allowed.has(v));
	return picked.length > 0 ? picked : [...DEFAULT_VISIBILITY_PROVIDERS];
}

export async function patchProjectMetadata(
	projectId: string,
	patch: Partial<{
		goal: OnboardingGoal | null;
		target_competitor_id: string | null;
		engines_to_run: VisibilityRunProvider[];
		locality: string | null;
	}>,
): Promise<void> {
	const { data, error } = await supabase.from('projects').select('metadata').eq('id', projectId).single();
	if (error) throw error;
	const current = asRecord(data?.metadata) ?? {};
	const next: Record<string, unknown> = { ...current };

	if ('goal' in patch) {
		if (patch.goal == null) delete next[GOAL_KEY];
		else next[GOAL_KEY] = patch.goal;
	}
	if ('target_competitor_id' in patch) {
		if (patch.target_competitor_id == null) delete next[TARGET_COMPETITOR_KEY];
		else next[TARGET_COMPETITOR_KEY] = patch.target_competitor_id;
	}
	if ('engines_to_run' in patch && patch.engines_to_run) {
		next[ENGINES_KEY] = patch.engines_to_run;
	}
	if ('locality' in patch) {
		const v = typeof patch.locality === 'string' ? patch.locality.trim().slice(0, 60) : '';
		if (!v) delete next[LOCALITY_KEY];
		else next[LOCALITY_KEY] = v;
	}

	const { error: upErr } = await supabase.from('projects').update({ metadata: next }).eq('id', projectId);
	if (upErr) throw upErr;
}
