import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GscErrorLine } from './GscErrorLine';
import { gscErrorMessage } from '../../services/gscConnection';

describe('the way out of a failed connection has to be clickable', () => {
	it('renders the Google permissions address as a real link', () => {
		render(<GscErrorLine text={gscErrorMessage('no_refresh_token')} />);

		const link = screen.getByRole('link');
		expect(link).toHaveAttribute('href', 'https://myaccount.google.com/permissions');
		expect(link).toHaveAttribute('rel', 'noopener noreferrer');
	});

	it('leaves an ordinary message as plain text', () => {
		render(<GscErrorLine text={gscErrorMessage('popup_closed')} />);

		expect(screen.queryByRole('link')).toBeNull();
		expect(screen.getByText(/closed/i)).toBeInTheDocument();
	});
});

describe('the error codes are translated, not English-only', () => {
	const load = (locale: string) =>
		JSON.parse(
			readFileSync(resolve(process.cwd(), `src/assets/locales/${locale}/translations.json`), 'utf8'),
		) as { gsc: { errors: Record<string, string> } };

	it('ships the same set of gsc error keys in English and Italian', () => {
		const en = load('en').gsc.errors;
		const it = load('it').gsc.errors;
		expect(Object.keys(it).sort()).toEqual(Object.keys(en).sort());
	});

	it('keeps the permissions link in the Italian message too', () => {
		const it = load('it').gsc.errors;
		expect(it['no_refresh_token']).toMatch(/https:\/\/myaccount\.google\.com\/permissions/);
		expect(it['no_refresh_token']).not.toEqual(load('en').gsc.errors['no_refresh_token']);
	});
});
