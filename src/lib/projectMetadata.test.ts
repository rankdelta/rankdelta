import { describe, expect, it } from 'vitest';
import {
	readEnginesToRun,
	readProjectGoal,
	readTargetCompetitorId,
} from './projectMetadata';
import type { Project } from '../types/database';

const baseProject = { metadata: null } as Project;

describe('projectMetadata', () => {
	it('reads goal from metadata', () => {
		expect(readProjectGoal({ ...baseProject, metadata: { goal: 'competitor' } })).toBe('competitor');
		expect(readProjectGoal({ ...baseProject, metadata: { goal: 'invalid' } })).toBeNull();
	});

	it('reads target competitor id', () => {
		expect(readTargetCompetitorId({ ...baseProject, metadata: { target_competitor_id: 'abc' } })).toBe('abc');
		expect(readTargetCompetitorId(baseProject)).toBeNull();
	});

	it('falls back to default engines', () => {
		const engines = readEnginesToRun(baseProject);
		expect(engines).toEqual(['chatgpt', 'perplexity', 'gemini', 'google_aio']);
	});

	it('reads custom engines from metadata', () => {
		expect(
			readEnginesToRun({
				...baseProject,
				metadata: { engines_to_run: ['chatgpt', 'perplexity'] },
			}),
		).toEqual(['chatgpt', 'perplexity']);
	});
});
