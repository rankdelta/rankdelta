import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { ArrowRightIcon, SignalIcon } from '@heroicons/react/24/outline';

export function AiVisibilityLinkStrip({ projectId }: { projectId: string }) {
	const { t } = useTranslation();

	return (
		<div className="rounded-2xl border border-violet-500/20 bg-gradient-to-br from-violet-500/[0.08] to-transparent p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
			<div className="flex items-start gap-3">
				<SignalIcon className="w-5 h-5 text-violet-300 shrink-0 mt-0.5" strokeWidth={1.8} />
				<div>
					<p className="text-white font-medium">{t('rankings.aiVisibilityTitle')}</p>
					<p className="text-sm text-white/50 mt-0.5 max-w-xl">{t('rankings.aiVisibilityDesc')}</p>
				</div>
			</div>
			<Link
				to="/visibility/$projectId"
				params={{ projectId }}
				className="inline-flex items-center gap-1.5 rounded-xl bg-violet-500 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-violet-400 shrink-0"
			>
				{t('rankings.aiVisibilityCta')}
				<ArrowRightIcon className="w-4 h-4" />
			</Link>
		</div>
	);
}
