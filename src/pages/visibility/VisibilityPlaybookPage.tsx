import { useTranslation } from 'react-i18next';

function BulletList({ body }: { body: string }) {
	const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
	return (
		<ul className="mt-3 space-y-2 text-sm text-white/70 list-disc pl-5">
			{lines.map((line) => (
				<li key={line}>{line}</li>
			))}
		</ul>
	);
}

export const VisibilityPlaybookPage = () => {
	const { t } = useTranslation();

	const blocks = [
		{ titleKey: 'visibility.playbookS1Title', bodyKey: 'visibility.playbookS1Body' },
		{ titleKey: 'visibility.playbookS2Title', bodyKey: 'visibility.playbookS2Body' },
		{ titleKey: 'visibility.playbookS3Title', bodyKey: 'visibility.playbookS3Body' },
		{ titleKey: 'visibility.playbookS4Title', bodyKey: 'visibility.playbookS4Body' },
	] as const;

	return (
		<div className="space-y-8 max-w-3xl">
			<div>
				<h2 className="text-lg font-semibold text-white">{t('visibility.playbookTitle')}</h2>
				<p className="text-sm text-white/60 mt-1">{t('visibility.playbookSubtitle')}</p>
			</div>

			<div className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.08] p-5">
				<p className="text-sm text-amber-300">{t('visibility.playbookDisclaimer')}</p>
			</div>

			<div className="space-y-4">
				{blocks.map((b) => (
					<div key={b.titleKey} className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
						<h3 className="font-semibold text-white">{t(b.titleKey)}</h3>
						<BulletList body={t(b.bodyKey)} />
					</div>
				))}
			</div>

			<p className="text-xs text-white/40">{t('visibility.playbookFooter')}</p>
		</div>
	);
};
