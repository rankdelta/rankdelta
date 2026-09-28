import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { ChevronRightIcon } from '@heroicons/react/24/outline';

type Props = {
	firstProjectId?: string;
	hasStores: boolean;
};

export function VisibilityHubGettingStarted({ firstProjectId, hasStores }: Props) {
	const { t } = useTranslation();
	const canDeepLink = !!firstProjectId;

	const steps = [
		{
			n: 1,
			title: t('visibility.hubStep1Title'),
			body: t('visibility.hubStep1Body'),
			highlight: !hasStores,
			content: (
				<Link
					to="/projects/new"
					className="mt-auto text-sm font-semibold text-violet-400 hover:text-violet-300 pt-2 inline-flex items-center gap-1 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40 focus-visible:ring-offset-2"
				>
					{t('visibility.hubStepGo')}
						<ChevronRightIcon className="w-3.5 h-3.5" strokeWidth={2} />
				</Link>
			),
		},
		{
			n: 2,
			title: t('visibility.hubStep2Title'),
			body: t('visibility.hubStep2Body'),
			highlight: hasStores && canDeepLink,
			content: canDeepLink ? (
				<Link
					to="/visibility/$projectId/competitors"
					params={{ projectId: firstProjectId }}
					className="mt-auto text-sm font-semibold text-violet-400 hover:text-violet-300 pt-2 inline-flex items-center gap-1 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40 focus-visible:ring-offset-2"
				>
					{t('visibility.hubStepGo')}
						<ChevronRightIcon className="w-3.5 h-3.5" strokeWidth={2} />
				</Link>
			) : (
				<p className="mt-auto text-xs text-white/40 pt-2">{t('visibility.hubStepLocked')}</p>
			),
		},
		{
			n: 3,
			title: t('visibility.hubStep3Title'),
			body: t('visibility.hubStep3Body'),
			highlight: hasStores && canDeepLink,
			content: canDeepLink ? (
				<Link
					to="/visibility/$projectId/queries"
					params={{ projectId: firstProjectId }}
					className="mt-auto text-sm font-semibold text-violet-400 hover:text-violet-300 pt-2 inline-flex items-center gap-1 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40 focus-visible:ring-offset-2"
				>
					{t('visibility.hubStepGo')}
						<ChevronRightIcon className="w-3.5 h-3.5" strokeWidth={2} />
				</Link>
			) : (
				<p className="mt-auto text-xs text-white/40 pt-2">{t('visibility.hubStepLocked')}</p>
			),
		},
	];

	return (
		<div className="rounded-2xl border border-violet-500/20 bg-gradient-to-br from-violet-500/[0.08] to-transparent p-5 sm:p-6 mb-8">
			<h2 className="text-sm font-semibold text-violet-300 uppercase tracking-wide">
				{t('visibility.hubGettingStartedTitle')}
			</h2>
			<p className="text-sm text-white/50 mt-1 mb-5 max-w-3xl">{t('visibility.hubGettingStartedSubtitle')}</p>
			<ol className="grid gap-4 md:grid-cols-3">
				{steps.map((s) => (
					<li
						key={s.n}
						className={`relative rounded-xl border p-4 flex flex-col gap-2 min-h-[140px] ${
							s.highlight ? 'border-violet-500/30 bg-violet-500/[0.06]' : 'border-white/[0.08] bg-white/[0.02]'
						}`}
					>
						<span
							className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
								s.highlight ? 'bg-violet-600 text-white' : 'bg-white/[0.08] text-white/50'
							}`}
							aria-hidden
						>
							{s.n}
						</span>
						<div>
							<h3 className="font-semibold text-white text-sm">{s.title}</h3>
							<p className="text-xs text-white/50 mt-1 leading-relaxed">{s.body}</p>
						</div>
						{s.content}
					</li>
				))}
			</ol>
		</div>
	);
}
