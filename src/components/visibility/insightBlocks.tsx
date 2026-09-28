import type { TFunction } from 'i18next';
import type { VisibilityMentionInsights } from '../../hooks/useVisibilityTracker';

export function providerLabel(t: TFunction, key: string): string {
	const k = `visibility.provider_${key}`;
	const translate = t as (fullKey: string) => string;
	const translated = translate(k);
	return translated === k ? key : translated;
}

export function TrackedSentimentBlock({ ins, t }: { ins: VisibilityMentionInsights; t: TFunction }) {
	const s = ins.trackedSentiment;
	const total = s.positive + s.neutral + s.negative + s.unknown;
	const pct = (n: number) => (total > 0 ? (100 * n) / total : 0);
	return (
		<>
			<div
				className="flex h-3 rounded-full overflow-hidden bg-white/[0.06]"
				role="img"
				aria-label={t('visibility.insightsSentimentTitle')}
			>
				{s.positive > 0 && (
					<div className="bg-emerald-500 min-w-0" style={{ width: `${pct(s.positive)}%` }} />
				)}
				{s.neutral > 0 && <div className="bg-white/30 min-w-0" style={{ width: `${pct(s.neutral)}%` }} />}
				{s.negative > 0 && <div className="bg-rose-500 min-w-0" style={{ width: `${pct(s.negative)}%` }} />}
				{s.unknown > 0 && <div className="bg-white/20 min-w-0" style={{ width: `${pct(s.unknown)}%` }} />}
			</div>
			<ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-white/60">
				<li>
					{t('visibility.insightsSentimentPositive')}:{' '}
					<span className="font-medium text-white tabular-nums">{s.positive}</span>
				</li>
				<li>
					{t('visibility.insightsSentimentNeutral')}:{' '}
					<span className="font-medium text-white tabular-nums">{s.neutral}</span>
				</li>
				<li>
					{t('visibility.insightsSentimentNegative')}:{' '}
					<span className="font-medium text-white tabular-nums">{s.negative}</span>
				</li>
				{s.unknown > 0 && (
					<li>
						{t('visibility.insightsSentimentUnknown')}:{' '}
						<span className="font-medium text-white tabular-nums">{s.unknown}</span>
					</li>
				)}
			</ul>
			{!ins.hasNonNeutralSentiment && (
				<p className="text-xs text-white/40 mt-3">{t('visibility.insightsSentimentNeutralOnly')}</p>
			)}
		</>
	);
}

type TrendPoint = { date: string; yours: number; competitors: number };

type SovPoint = { date: string; yours: number; competitors: number; sovPercent: number | null };

/**
 * Share-of-Voice over time — dependency-free SVG line chart. Plots daily SoV % across the selected
 * range so a client can see "0% → 12% over 90 days". Days with no mentions are gaps; the line
 * connects the days that do have data. Includes a 50% reference line and an end-value label.
 */
export function SovTrendChart({ trend, t }: { trend: SovPoint[]; t: TFunction }) {
	const W = 720;
	const H = 200;
	const padL = 34;
	const padR = 44;
	const padT = 14;
	const padB = 22;
	const n = trend.length;
	const pts = trend
		.map((d, i) => ({ i, sov: d.sovPercent, date: d.date }))
		.filter((p): p is { i: number; sov: number; date: string } => p.sov != null);

	if (pts.length < 2) {
		return <p className="text-sm text-white/40">{t('visibility.insightsSovTrendEmpty')}</p>;
	}

	const x = (i: number) => padL + (n <= 1 ? 0 : (i / (n - 1)) * (W - padL - padR));
	const y = (sov: number) => padT + (1 - sov / 100) * (H - padT - padB);
	const first = pts[0]!;
	const last = pts[pts.length - 1]!;
	const line = pts.map((p, k) => `${k === 0 ? 'M' : 'L'}${x(p.i).toFixed(1)},${y(p.sov).toFixed(1)}`).join(' ');
	const area = `${line} L${x(last.i).toFixed(1)},${(H - padB).toFixed(1)} L${x(first.i).toFixed(1)},${(H - padB).toFixed(1)} Z`;
	const delta = last.sov - first.sov;

	return (
		<div className="space-y-2">
			<svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={t('visibility.insightsSovTrendTitle')}>
				<defs>
					<linearGradient id="sovFill" x1="0" y1="0" x2="0" y2="1">
						<stop offset="0%" stopColor="rgb(167 139 250)" stopOpacity="0.28" />
						<stop offset="100%" stopColor="rgb(167 139 250)" stopOpacity="0" />
					</linearGradient>
				</defs>
				{[0, 25, 50, 75, 100].map((g) => (
					<g key={g}>
						<line
							x1={padL}
							x2={W - padR}
							y1={y(g)}
							y2={y(g)}
							stroke="rgba(255,255,255,0.08)"
							strokeWidth="1"
							strokeDasharray={g === 50 ? '4 4' : undefined}
						/>
						<text x={padL - 6} y={y(g) + 3} textAnchor="end" className="fill-white/30" style={{ fontSize: 9 }}>
							{g}%
						</text>
					</g>
				))}
				<path d={area} fill="url(#sovFill)" />
				<path d={line} fill="none" stroke="rgb(167 139 250)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
				<circle cx={x(last.i)} cy={y(last.sov)} r="3.5" className="fill-violet-300" />
				<text x={x(last.i) + 6} y={y(last.sov) + 3} className="fill-violet-200 font-semibold" style={{ fontSize: 11 }}>
					{last.sov.toFixed(0)}%
				</text>
			</svg>
			<div className="flex flex-wrap items-center justify-between gap-2 text-xs text-white/40">
				<span>
					{first.date.slice(5)} → {last.date.slice(5)}
				</span>
				<span
					className={`font-medium tabular-nums ${
						delta > 0 ? 'text-emerald-400' : delta < 0 ? 'text-rose-400' : 'text-white/50'
					}`}
				>
					{delta > 0 ? '+' : ''}
					{delta.toFixed(1)} pp
				</span>
			</div>
		</div>
	);
}

type CompetitorTrendPoint = { date: string; yours: number; byCompetitor: Record<string, number> }

/**
 * Share of Voice vs each competitor over time — dependency-free multi-line SVG. For each day, every
 * series' value is its share of that day's total mentions (yours + all competitors). Lets a client
 * see "I'm gaining on Branch but losing to Firebase." Mirrors SovTrendChart's geometry.
 */
export function CompetitorSovTrend({
	competitorTrend,
	topCompetitorIds,
	competitorNames,
	t,
}: {
	competitorTrend: CompetitorTrendPoint[]
	topCompetitorIds: string[]
	competitorNames: Record<string, string>
	t: TFunction
}) {
	const W = 720
	const H = 200
	const padL = 34
	const padR = 44
	const padT = 14
	const padB = 22
	const n = competitorTrend.length
	const COLORS = ['rgb(167 139 250)', 'rgb(56 189 248)', 'rgb(251 191 36)', 'rgb(244 114 182)']

	const series = [
		{ id: '__yours__', name: t('visibility.colYourMentions'), color: COLORS[0]! },
		...topCompetitorIds.slice(0, 3).map((id, i) => ({
			id,
			name: competitorNames[id] ?? `${id.slice(0, 8)}…`,
			color: COLORS[i + 1]!,
		})),
	]

	const valueFor = (pt: CompetitorTrendPoint, id: string) =>
		id === '__yours__' ? pt.yours : pt.byCompetitor[id] ?? 0
	const totalFor = (pt: CompetitorTrendPoint) =>
		pt.yours + Object.values(pt.byCompetitor).reduce((a, b) => a + b, 0)

	const x = (i: number) => padL + (n <= 1 ? 0 : (i / (n - 1)) * (W - padL - padR))
	const y = (sov: number) => padT + (1 - sov / 100) * (H - padT - padB)

	// Build each series' polyline over days that have any mentions.
	const lines = series.map((s) => {
		const pts = competitorTrend
			.map((pt, i) => {
				const tot = totalFor(pt)
				return tot > 0 ? { i, sov: (100 * valueFor(pt, s.id)) / tot } : null
			})
			.filter((p): p is { i: number; sov: number } => p !== null)
		return { ...s, pts, d: pts.map((p, k) => `${k === 0 ? 'M' : 'L'}${x(p.i).toFixed(1)},${y(p.sov).toFixed(1)}`).join(' ') }
	})

	const renderable = lines.filter((l) => l.pts.length >= 2)
	if (renderable.length === 0) {
		return <p className="text-sm text-white/40">{t('visibility.insightsCompetitorTrendEmpty')}</p>
	}

	return (
		<div className="space-y-3">
			<svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={t('visibility.insightsCompetitorTrendTitle')}>
				{[0, 25, 50, 75, 100].map((g) => (
					<g key={g}>
						<line x1={padL} x2={W - padR} y1={y(g)} y2={y(g)} stroke="rgba(255,255,255,0.08)" strokeWidth="1" strokeDasharray={g === 50 ? '4 4' : undefined} />
						<text x={padL - 6} y={y(g) + 3} textAnchor="end" className="fill-white/30" style={{ fontSize: 9 }}>
							{g}%
						</text>
					</g>
				))}
				{renderable.map((l) => {
					const last = l.pts[l.pts.length - 1]!
					return (
						<g key={l.id}>
							<path d={l.d} fill="none" stroke={l.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
							<circle cx={x(last.i)} cy={y(last.sov)} r="3" style={{ fill: l.color }} />
						</g>
					)
				})}
			</svg>
			<div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
				{renderable.map((l) => (
					<span key={l.id} className="inline-flex items-center gap-1.5 text-white/60">
						<span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: l.color }} />
						{l.name}
					</span>
				))}
			</div>
		</div>
	)
}

export function Trend14dBars({
	trend14d,
	maxTrend,
	t,
}: {
	trend14d: TrendPoint[];
	maxTrend: number;
	t: TFunction;
}) {
	return (
		<>
			<div
				className="flex items-end gap-0.5 h-36 border-b border-white/[0.08] pb-1"
				role="img"
				aria-label={t('visibility.insightsTrend14d')}
			>
				{trend14d.map((d) => {
					const hY = (d.yours / maxTrend) * 100;
					const hC = (d.competitors / maxTrend) * 100;
					return (
						<div
							key={d.date}
							className="flex-1 min-w-0 flex flex-col justify-end gap-0.5 group"
							title={`${d.date}: ${d.yours} / ${d.competitors}`}
						>
							<div className="flex gap-0.5 justify-center items-end h-full">
								<div
									className="w-1/2 max-w-[6px] rounded-t bg-violet-500/80 min-h-[2px]"
									style={{ height: `${Math.max(hY, d.yours > 0 ? 8 : 0)}%` }}
								/>
								<div
									className="w-1/2 max-w-[6px] rounded-t bg-white/30 min-h-[2px]"
									style={{ height: `${Math.max(hC, d.competitors > 0 ? 8 : 0)}%` }}
								/>
							</div>
							<span className="text-[9px] text-white/30 text-center truncate leading-none pt-1 opacity-0 group-hover:opacity-100 sm:opacity-100">
								{d.date.slice(5)}
							</span>
						</div>
					);
				})}
			</div>
			<p className="text-xs text-white/40 mt-3 flex flex-wrap gap-4">
				<span className="inline-flex items-center gap-1.5">
					<span className="w-2.5 h-2.5 rounded-sm bg-violet-500" /> {t('visibility.colYourMentions')}
				</span>
				<span className="inline-flex items-center gap-1.5">
					<span className="w-2.5 h-2.5 rounded-sm bg-white/30" /> {t('visibility.colTheirMentions')}
				</span>
			</p>
		</>
	);
}
