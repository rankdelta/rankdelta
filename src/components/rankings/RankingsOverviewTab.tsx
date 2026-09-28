import { useTranslation } from 'react-i18next';
import {
	ArrowPathIcon,
	CursorArrowRaysIcon,
	EyeIcon,
	ArrowTrendingUpIcon,
	LinkIcon,
	MagnifyingGlassIcon,
} from '@heroicons/react/24/outline';
import type { Project } from '../../types/database';
import type { GscOverview } from '../../services/googleSearchConsole';
import { useGscProperty } from '../../hooks/useGscProperty';
import { GscErrorLine } from './GscErrorLine';
import { GscAiCorrelationPanel } from '../analytics/GscAiCorrelationPanel';
import { Ga4OverviewPanel } from '../analytics/Ga4OverviewPanel';
import { RankSummaryStrip } from './RankSummaryStrip';
import { AiVisibilityLinkStrip } from './AiVisibilityLinkStrip';

function Panel({ children }: { children: React.ReactNode }) {
	return <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6">{children}</div>;
}

function Kpi({
	label,
	value,
	Icon,
	accent,
}: {
	label: string;
	value: string;
	Icon: typeof EyeIcon;
	accent: string;
}) {
	return (
		<div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
			<div className="flex items-center justify-between mb-2">
				<span className="text-xs text-white/40">{label}</span>
				<Icon className={`w-4 h-4 ${accent}`} />
			</div>
			<div className={`text-2xl font-bold ${accent}`}>{value}</div>
		</div>
	);
}

function RowsCard({
	title,
	rows,
	pageMode,
}: {
	title: string;
	rows: GscOverview['topQueries'];
	pageMode?: boolean;
}) {
	const { t } = useTranslation();
	return (
		<div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
			<h3 className="text-sm font-semibold text-white mb-3">{title}</h3>
			{rows.length === 0 ? (
				<p className="text-sm text-white/35">{t('gsc.noData')}</p>
			) : (
				<div className="space-y-1.5">
					{rows.map((r) => (
						<div key={r.key} className="flex items-center gap-3 text-sm">
							<span className="flex-1 min-w-0 truncate text-white/75" title={r.key}>
								{pageMode ? r.key.replace(/^https?:\/\/[^/]+/, '') || '/' : r.key}
							</span>
							<span className="text-white/40 tabular-nums w-12 text-right">{r.clicks}</span>
							<span className="text-white/25 tabular-nums w-10 text-right">#{r.position.toFixed(0)}</span>
						</div>
					))}
				</div>
			)}
		</div>
	);
}

function GoogleGlyph() {
	return (
		<svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden>
			<path
				fill="#4285F4"
				d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z"
			/>
			<path
				fill="#34A853"
				d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.26 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
			/>
			<path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z" />
			<path
				fill="#EA4335"
				d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z"
			/>
		</svg>
	);
}

export function RankingsOverviewTab({ project }: { project: Project }) {
	const { t, i18n } = useTranslation();
	const gsc = useGscProperty(project.id, project.website_url);

	if (!gsc.configured) {
		return (
			<div className="space-y-6">
				<Panel>
					<h3 className="text-white font-semibold mb-1.5">{t('gsc.configRequiredTitle')}</h3>
					<p className="text-sm text-white/50 mb-4 max-w-xl">{t('gsc.configRequiredDesc')}</p>
					<ol className="text-sm text-white/55 space-y-1.5 list-decimal list-inside mb-4">
						<li>{t('gsc.step1')}</li>
						<li>{t('gsc.step2')}</li>
						<li>{t('gsc.step3')}</li>
						<li>
							{t('gsc.step4Before')} <code className="text-violet-300">VITE_GOOGLE_CLIENT_ID</code>{' '}
							{t('gsc.step4After')}
						</li>
					</ol>
					<a
						href="https://console.cloud.google.com/apis/credentials"
						target="_blank"
						rel="noopener noreferrer"
						className="inline-flex items-center gap-1.5 text-sm text-violet-300 hover:text-violet-200"
					>
						<LinkIcon className="w-4 h-4" />
						{t('gsc.openGoogleCloudConsole')}
					</a>
				</Panel>
				<div className="pt-2 border-t border-white/[0.06]">
					<h2 className="text-sm font-semibold text-white/70 mb-4">{t('ga4.sectionTitle')}</h2>
					<Ga4OverviewPanel project={project} />
				</div>
			</div>
		);
	}

	// The connection lives on the server, so it takes a round trip to know. Showing
	// the "connect" call to action in the meantime is exactly the flash of
	// "not connected" the customer reported — wait for the answer instead.
	if (!gsc.connected && gsc.loading) {
		return (
			<div className="space-y-6" data-testid="gsc-status-loading">
				<div className="h-40 rounded-2xl bg-white/[0.04] animate-pulse" />
				<div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
					{[0, 1, 2, 3].map((i) => (
						<div key={i} className="h-28 rounded-2xl bg-white/[0.04] animate-pulse" />
					))}
				</div>
			</div>
		);
	}

	if (!gsc.connected) {
		return (
			<div className="space-y-6">
				<Panel>
					<h3 className="text-xl font-bold text-white mb-2">{t('rankings.connectHeroTitle')}</h3>
					<p className="text-sm text-white/50 mb-5 max-w-xl">{t('rankings.connectHeroDesc')}</p>
					{gsc.error && <GscErrorLine text={gsc.error} />}
					<button
						onClick={() => void gsc.handleConnect()}
						disabled={gsc.connecting}
						className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-2.5 font-medium text-gray-900 transition hover:bg-white/90 disabled:opacity-60"
					>
						{gsc.connecting ? <ArrowPathIcon className="w-5 h-5 animate-spin" /> : <GoogleGlyph />}
						{gsc.connecting ? t('gsc.connecting') : t('gsc.connectWithGoogle')}
					</button>
				</Panel>
				<RankSummaryStrip projectId={project.id} />
				<div className="pt-2 border-t border-white/[0.06]">
					<h2 className="text-sm font-semibold text-white/70 mb-4">{t('ga4.sectionTitle')}</h2>
					<Ga4OverviewPanel project={project} />
				</div>
				<AiVisibilityLinkStrip projectId={project.id} />
			</div>
		);
	}

	return (
		<div className="space-y-6">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="flex items-center gap-2">
					<span className="text-xs text-white/40">{t('gsc.property')}</span>
					<select
						value={gsc.property ?? ''}
						onChange={(e) => gsc.selectProperty(e.target.value)}
						className="rounded-lg bg-white/[0.04] border border-white/[0.1] px-3 py-1.5 text-sm text-white/80 focus:outline-none focus:border-violet-500/50"
					>
						{gsc.properties.length === 0 && gsc.property && (
							<option value={gsc.property}>{gsc.property}</option>
						)}
						{gsc.properties.map((p) => (
							<option key={p.siteUrl} value={p.siteUrl} className="bg-[#111]">
								{p.siteUrl}
							</option>
						))}
					</select>
				</div>
				<button onClick={gsc.disconnect} className="text-xs text-white/40 hover:text-white/70">
					{t('gsc.disconnect')}
				</button>
			</div>

			{gsc.revoked && (
				<div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
					<p className="text-sm text-amber-100">{t('gsc.revokedBanner')}</p>
					<button
						onClick={gsc.handleConnect}
						disabled={gsc.connecting}
						className="rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-black hover:bg-white/90 disabled:opacity-60"
					>
						{t('gsc.reconnect')}
					</button>
				</div>
			)}

			{gsc.error && <GscErrorLine text={gsc.error} />}

			<RankSummaryStrip projectId={project.id} />

			{gsc.loading && !gsc.overview ? (
				<div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
					{[0, 1, 2, 3].map((i) => (
						<div key={i} className="h-28 rounded-2xl bg-white/[0.04] animate-pulse" />
					))}
				</div>
			) : gsc.overview ? (
				<>
					<p className="text-xs text-white/35 -mb-2">{t('gsc.last28Days')}</p>
					<div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
						<Kpi
							label={t('gsc.clicks')}
							value={gsc.overview.totals.clicks.toLocaleString(i18n.language)}
							Icon={CursorArrowRaysIcon}
							accent="text-emerald-300"
						/>
						<Kpi
							label={t('gsc.impressions')}
							value={gsc.overview.totals.impressions.toLocaleString(i18n.language)}
							Icon={EyeIcon}
							accent="text-sky-300"
						/>
						<Kpi
							label={t('gsc.ctr')}
							value={`${(gsc.overview.totals.ctr * 100).toFixed(1)}%`}
							Icon={ArrowTrendingUpIcon}
							accent="text-violet-300"
						/>
						<Kpi
							label={t('gsc.avgPosition')}
							value={gsc.overview.totals.position.toFixed(1)}
							Icon={MagnifyingGlassIcon}
							accent="text-amber-300"
						/>
					</div>

					<div className="grid lg:grid-cols-2 gap-6">
						<RowsCard title={t('gsc.topQueries')} rows={gsc.overview.topQueries} />
						<RowsCard title={t('gsc.topPages')} rows={gsc.overview.topPages} pageMode />
					</div>

					{gsc.property && <GscAiCorrelationPanel projectId={project.id} property={gsc.property} />}
				</>
			) : (
				<Panel>
					<p className="text-sm text-white/45">{t('gsc.noDataForProperty')}</p>
				</Panel>
			)}

			<div className="pt-2 border-t border-white/[0.06]">
				<h2 className="text-sm font-semibold text-white/70 mb-4">{t('ga4.sectionTitle')}</h2>
				<Ga4OverviewPanel project={project} />
			</div>

			<AiVisibilityLinkStrip projectId={project.id} />
		</div>
	);
}
