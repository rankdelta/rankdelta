import { useTranslation } from 'react-i18next';
import {
	ArrowPathIcon,
	ChartBarIcon,
	CursorArrowRaysIcon,
	EyeIcon,
	LinkIcon,
	UserGroupIcon,
} from '@heroicons/react/24/outline';
import type { Project } from '../../types/database';
import type { Ga4Overview } from '../../services/googleAnalytics4';
import { useGa4Property } from '../../hooks/useGa4Property';

function Panel({ children }: { children: React.ReactNode }) {
	return <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6">{children}</div>;
}

function ErrorLine({ text }: { text: string }) {
	return (
		<div className="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-200">
			{text}
		</div>
	);
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
	rows: Ga4Overview['topPages'];
	pageMode?: boolean;
}) {
	const { t } = useTranslation();
	return (
		<div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
			<h3 className="text-sm font-semibold text-white mb-3">{title}</h3>
			{rows.length === 0 ? (
				<p className="text-sm text-white/35">{t('ga4.noData')}</p>
			) : (
				<div className="space-y-1.5">
					{rows.map((r) => (
						<div key={r.key} className="flex items-center gap-3 text-sm">
							<span className="flex-1 min-w-0 truncate text-white/75" title={r.key}>
								{pageMode ? r.key || '/' : r.key}
							</span>
							<span className="text-white/40 tabular-nums w-14 text-right">{r.sessions}</span>
							<span className="text-white/25 tabular-nums w-12 text-right">{r.users}</span>
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

export function Ga4OverviewPanel({ project }: { project: Project }) {
	const { t, i18n } = useTranslation();
	const ga4 = useGa4Property(project.id, project.website_url);

	if (!ga4.configured) {
		return (
			<Panel>
				<h3 className="text-white font-semibold mb-1.5">{t('ga4.configRequiredTitle')}</h3>
				<p className="text-sm text-white/50 mb-4 max-w-xl">{t('ga4.configRequiredDesc')}</p>
				<ol className="text-sm text-white/55 space-y-1.5 list-decimal list-inside mb-4">
					<li>{t('ga4.step1')}</li>
					<li>{t('ga4.step2')}</li>
					<li>{t('ga4.step3')}</li>
					<li>
						{t('ga4.step4Before')} <code className="text-violet-300">VITE_GOOGLE_CLIENT_ID</code>{' '}
						{t('ga4.step4After')}
					</li>
				</ol>
				<a
					href="https://console.cloud.google.com/apis/credentials"
					target="_blank"
					rel="noopener noreferrer"
					className="inline-flex items-center gap-1.5 text-sm text-violet-300 hover:text-violet-200"
				>
					<LinkIcon className="w-4 h-4" />
					{t('ga4.openGoogleCloudConsole')}
				</a>
			</Panel>
		);
	}

	if (!ga4.connected) {
		return (
			<Panel>
				<h3 className="text-lg font-bold text-white mb-2">{t('ga4.connectTitle')}</h3>
				<p className="text-sm text-white/50 mb-5 max-w-xl">{t('ga4.connectDesc')}</p>
				{ga4.error && <ErrorLine text={ga4.error} />}
				<button
					onClick={() => void ga4.handleConnect()}
					disabled={ga4.connecting}
					className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-2.5 font-medium text-gray-900 transition hover:bg-white/90 disabled:opacity-60"
				>
					{ga4.connecting ? <ArrowPathIcon className="w-5 h-5 animate-spin" /> : <GoogleGlyph />}
					{ga4.connecting ? t('ga4.connecting') : t('ga4.connectWithGoogle')}
				</button>
			</Panel>
		);
	}

	return (
		<div className="space-y-4">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="flex items-center gap-2">
					<span className="text-xs text-white/40">{t('ga4.property')}</span>
					<select
						value={ga4.property ?? ''}
						onChange={(e) => ga4.selectProperty(e.target.value)}
						className="rounded-lg bg-white/[0.04] border border-white/[0.1] px-3 py-1.5 text-sm text-white/80 focus:outline-none focus:border-violet-500/50"
					>
						{ga4.properties.length === 0 && ga4.property && (
							<option value={ga4.property}>{ga4.property}</option>
						)}
						{ga4.properties.map((p) => (
							<option key={p.propertyId} value={p.propertyId} className="bg-[#111]">
								{p.displayName}
							</option>
						))}
					</select>
				</div>
				<button onClick={ga4.disconnect} className="text-xs text-white/40 hover:text-white/70">
					{t('ga4.disconnect')}
				</button>
			</div>

			{ga4.error && <ErrorLine text={ga4.error} />}

			{ga4.loading && !ga4.overview ? (
				<div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
					{[0, 1, 2, 3].map((i) => (
						<div key={i} className="h-28 rounded-2xl bg-white/[0.04] animate-pulse" />
					))}
				</div>
			) : ga4.overview ? (
				<>
					<p className="text-xs text-white/35 -mb-2">{t('ga4.last28Days')}</p>
					<div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
						<Kpi
							label={t('ga4.sessions')}
							value={ga4.overview.totals.sessions.toLocaleString(i18n.language)}
							Icon={CursorArrowRaysIcon}
							accent="text-emerald-300"
						/>
						<Kpi
							label={t('ga4.users')}
							value={ga4.overview.totals.users.toLocaleString(i18n.language)}
							Icon={UserGroupIcon}
							accent="text-sky-300"
						/>
						<Kpi
							label={t('ga4.pageviews')}
							value={ga4.overview.totals.pageviews.toLocaleString(i18n.language)}
							Icon={EyeIcon}
							accent="text-violet-300"
						/>
						<Kpi
							label={t('ga4.bounceRate')}
							value={`${(ga4.overview.totals.bounceRate * 100).toFixed(1)}%`}
							Icon={ChartBarIcon}
							accent="text-amber-300"
						/>
					</div>

					<div className="grid lg:grid-cols-2 gap-6">
						<RowsCard title={t('ga4.topPages')} rows={ga4.overview.topPages} pageMode />
						<RowsCard title={t('ga4.topSources')} rows={ga4.overview.topSources} />
					</div>
				</>
			) : (
				<Panel>
					<p className="text-sm text-white/45">{t('ga4.noDataForProperty')}</p>
				</Panel>
			)}
		</div>
	);
}
