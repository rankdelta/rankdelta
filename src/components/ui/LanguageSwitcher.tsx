/**
 * Language Switcher — compact dark segmented IT | EN toggle for the app sidebar.
 *
 * Switches the UI language at runtime via i18next and persists the choice to
 * localStorage ('i18nextLng', read back in src/common/i18n.ts on next load).
 * Intentionally minimal/non-invasive to match the dark premium UI.
 */

import { useTranslation } from 'react-i18next';

const LANGUAGES = [
	{ code: 'it', label: 'IT' },
	{ code: 'en', label: 'EN' },
] as const;

const normalize = (lang: string): string => lang.split('-')[0] || 'en';

export const LanguageSwitcher = () => {
	const { t, i18n } = useTranslation();
	const current = normalize(i18n.language || 'en');

	const change = (code: string) => {
		if (code === current) return;
		void i18n.changeLanguage(code);
		localStorage.setItem('i18nextLng', code);
	};

	return (
		<div
			role="group"
			aria-label={t('common.language')}
			className="inline-flex items-center gap-0.5 rounded-lg border border-white/[0.06] bg-white/[0.02] p-0.5"
		>
			{LANGUAGES.map((lang) => {
				const active = current === lang.code;
				return (
					<button
						key={lang.code}
						type="button"
						onClick={() => change(lang.code)}
						aria-pressed={active}
						className={`px-2 py-0.5 text-[11px] font-semibold rounded-md transition-colors ${
							active
								? 'bg-white/[0.12] text-white/90'
								: 'text-white/40 hover:text-white/70'
						}`}
					>
						{lang.label}
					</button>
				);
			})}
		</div>
	);
};
