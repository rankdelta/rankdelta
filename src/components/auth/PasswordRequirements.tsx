/**
 * PasswordRequirements
 *
 * A live checklist that mirrors the Supabase Auth password policy (length + lowercase +
 * uppercase + digit + symbol). Rendered under password fields so the user knows exactly what's
 * required *before* submitting — otherwise Supabase rejects weak passwords with a cryptic error.
 *
 * Each rule turns green with a check the moment the typed password satisfies it.
 */

import { useTranslation } from 'react-i18next';
import { getPasswordChecks, PASSWORD_MIN_LENGTH, type PasswordChecks } from '../../utils/validation';

interface PasswordRequirementsProps {
	password: string;
	/** Hide the list entirely until the user has started typing. */
	showWhenEmpty?: boolean;
}

export const PasswordRequirements = ({ password, showWhenEmpty = false }: PasswordRequirementsProps) => {
	const { t } = useTranslation();
	const checks = getPasswordChecks(password);

	if (!password && !showWhenEmpty) return null;

	// Explicit literal keys (i18next's typed key map rejects dynamically-built keys).
	const rules: Array<{ key: keyof PasswordChecks; label: string }> = [
		{ key: 'minLength', label: t('passwordRules.minLength', { count: PASSWORD_MIN_LENGTH }) },
		{ key: 'lowercase', label: t('passwordRules.lowercase') },
		{ key: 'uppercase', label: t('passwordRules.uppercase') },
		{ key: 'digit', label: t('passwordRules.digit') },
		{ key: 'symbol', label: t('passwordRules.symbol') },
	];

	return (
		<ul className="mt-2 space-y-1.5" aria-label={t('passwordRules.title')}>
			{rules.map(({ key, label }) => {
				const met = checks[key];
				return (
					<li
						key={key}
						className={`flex items-center gap-2 text-xs transition-colors ${
							met ? 'text-emerald-300' : 'text-white/40'
						}`}
					>
						{met ? (
							<svg className="w-3.5 h-3.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
								<path
									fillRule="evenodd"
									d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
									clipRule="evenodd"
								/>
							</svg>
						) : (
							<svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 20 20" stroke="currentColor" aria-hidden="true">
								<circle cx="10" cy="10" r="7" strokeWidth="1.5" />
							</svg>
						)}
						<span>{label}</span>
					</li>
				);
			})}
		</ul>
	);
};

export default PasswordRequirements;
