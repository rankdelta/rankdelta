import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const MIGRATIONS_DIR = path.resolve(process.cwd(), 'supabase/migrations');
const MIGRATION_FILE_PATTERN = /^(\d+)_(.+)\.sql$/;

describe('supabase migration files', () => {
	const files = readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith('.sql'));

	it('includes at least one migration file', () => {
		expect(files.length).toBeGreaterThan(0);
	});

	it('names every file as <version>_<name>.sql with unique versions', () => {
		const versions = new Set<string>();

		for (const file of files) {
			const match = file.match(MIGRATION_FILE_PATTERN);
			if (!match) {
				expect.fail(`invalid migration filename: ${file}`);
				return;
			}
			const version = match[1];
			if (!version) {
				expect.fail(`missing version: ${file}`);
				return;
			}
			// Legacy short prefixes may collide; timestamp versions (CI-applied) must be unique.
			if (version.length >= 14) {
				expect(versions.has(version), `duplicate migration version: ${version}`).toBe(false);
				versions.add(version);
			}
		}
	});

	it('does not include empty migration files', () => {
		for (const file of files) {
			const contents = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
			expect(contents.trim().length, `empty migration file: ${file}`).toBeGreaterThan(0);
		}
	});
});
