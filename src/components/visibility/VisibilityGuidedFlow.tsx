import { useTranslation } from 'react-i18next';
import { CheckCircleIcon } from '@heroicons/react/24/solid';
import type { VisibilitySetupPhase } from '../../lib/visibilitySetupPhase';
import { visibilitySetupStepIndex } from '../../lib/visibilitySetupPhase';

type Props = {
	projectId: string;
	phase: VisibilitySetupPhase;
	/** Optional primary action rendered inside the current step card. */
	primaryAction?: React.ReactNode;
	compact?: boolean;
};

const STEPS = [
	{ key: 'step1', titleKey: 'visibility.guidedStep1Title', bodyKey: 'visibility.guidedStep1Body' },
	{ key: 'step2', titleKey: 'visibility.guidedStep2Title', bodyKey: 'visibility.guidedStep2Body' },
	{ key: 'step3', titleKey: 'visibility.guidedStep3Title', bodyKey: 'visibility.guidedStep3Body' },
	{ key: 'step4', titleKey: 'visibility.guidedStep4Title', bodyKey: 'visibility.guidedStep4Body' },
] as const;

export function VisibilityGuidedFlow({ projectId: _projectId, phase, primaryAction, compact }: Props) {
	const { t } = useTranslation();
	if (phase === 'measured') return null;

	const current = visibilitySetupStepIndex(phase);

	return (
		<section
			className="rounded-2xl border border-violet-500/25 bg-gradient-to-br from-violet-500/[0.1] to-transparent p-5 sm:p-6 space-y-5"
			aria-labelledby="visibility-guided-flow-title"
		>
			<div>
				<p className="text-xs font-semibold uppercase tracking-wide text-violet-300">
					{t('visibility.guidedFlowEyebrow')}
				</p>
				<h2 id="visibility-guided-flow-title" className="text-lg font-bold text-white mt-1">
					{t('visibility.guidedFlowTitle')}
				</h2>
				<p className="text-sm text-white/55 mt-1 max-w-2xl leading-relaxed">
					{t('visibility.guidedFlowSubtitle')}
				</p>
			</div>

			{!compact && (
				<ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
					{STEPS.map((step, i) => {
						const n = i + 1;
						const done = n < current;
						const active = n === current;
						return (
							<li
								key={step.key}
								className={`rounded-xl border p-3.5 flex flex-col gap-1.5 ${
									active
										? 'border-violet-500/40 bg-violet-500/[0.08]'
										: done
											? 'border-emerald-500/25 bg-emerald-500/[0.06]'
											: 'border-white/[0.08] bg-white/[0.02] opacity-70'
								}`}
							>
								<div className="flex items-center gap-2">
									{done ? (
										<CheckCircleIcon className="w-5 h-5 text-emerald-400 shrink-0" aria-hidden />
									) : (
										<span
											className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold shrink-0 ${
												active ? 'bg-violet-600 text-white' : 'bg-white/[0.08] text-white/45'
											}`}
											aria-hidden
										>
											{n}
										</span>
									)}
									<span className="text-sm font-semibold text-white">{t(step.titleKey)}</span>
								</div>
								<p className="text-xs text-white/50 leading-relaxed pl-0 sm:pl-8">{t(step.bodyKey)}</p>
							</li>
						);
					})}
				</ol>
			)}

			<div className="rounded-xl border border-white/[0.1] bg-white/[0.03] p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
				<div className="space-y-1">
					<p className="text-sm font-semibold text-white">
						{t(STEPS[current - 1]!.titleKey)}
					</p>
					<p className="text-sm text-white/55 leading-relaxed max-w-xl">
						{t(STEPS[current - 1]!.bodyKey)}
					</p>
				</div>
				{primaryAction && <div className="shrink-0">{primaryAction}</div>}
			</div>
		</section>
	);
}
