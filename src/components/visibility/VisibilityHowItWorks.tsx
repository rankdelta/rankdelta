import { useTranslation } from 'react-i18next';
import { InformationCircleIcon } from '@heroicons/react/24/outline';

type Props = { variant?: 'default' | 'compact' };

export function VisibilityHowItWorks({ variant = 'default' }: Props) {
	const { t } = useTranslation();

	if (variant === 'compact') {
		return (
			<p className="text-sm text-white/60 max-w-3xl leading-relaxed border-l-2 border-violet-500/20 pl-3">
				{t('visibility.howItWorksCompact')}
			</p>
		);
	}

	return (
		<div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4 sm:p-5">
			<details>
				<summary className="cursor-pointer list-none font-semibold text-white text-sm flex items-center gap-2 marker:content-['']">
					<InformationCircleIcon className="w-4 h-4 text-violet-400 flex-shrink-0" strokeWidth={1.8} aria-hidden />
					{t('visibility.howItWorksTitle')}
				</summary>
				<ul className="mt-3 space-y-2.5 text-sm text-white/60 leading-relaxed pl-6 list-disc marker:text-violet-400">
					<li>{t('visibility.howItWorksBulletQueries')}</li>
					<li>{t('visibility.howItWorksBulletRuns')}</li>
					<li>{t('visibility.howItWorksBulletTrend')}</li>
					<li>{t('visibility.howItWorksBulletModels')}</li>
					<li>{t('visibility.howItWorksBulletSchedule')}</li>
				</ul>
			</details>
		</div>
	);
}
