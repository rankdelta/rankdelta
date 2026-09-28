import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { VisibilityQueryRunRow } from '../../types/database';
import { hrefOf } from '../../lib/seoUrls';
import { Button } from '../ui/Button';

export type ReceiptCitation = {
	url: string | null;
	domain: string | null;
	title: string | null;
};

type Props = {
	receipts: Array<{ run: VisibilityQueryRunRow; promptText: string }>;
	onClose: () => void;
};

/**
 * Answer receipts modal — raw evidence behind a visibility metric: each saved AI answer
 * (verbatim, from visibility_query_runs.answer_text) with the domains it cited (cited_sources).
 * Read-only; no re-scans.
 */
export function AnswerReceiptsModal({ receipts, onClose }: Props) {
	const { t } = useTranslation();

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') onClose();
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [onClose]);

	useEffect(() => {
		const prevOverflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		return () => {
			document.body.style.overflow = prevOverflow;
		};
	}, []);

	return (
		<div
			className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-[#080808]/50 backdrop-blur-sm motion-safe:transition-opacity"
			role="dialog"
			aria-modal="true"
			aria-labelledby="receipts-title"
			onClick={onClose}
		>
			<div
				className="bg-[#111] rounded-t-2xl sm:rounded-2xl shadow-2xl max-w-3xl w-full max-h-[min(92vh,900px)] flex flex-col border border-white/[0.08]"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-white/[0.06] shrink-0">
					<div className="min-w-0">
						<h2 id="receipts-title" className="text-lg font-semibold text-white">
							{t('visibility.receiptsTitle')}
						</h2>
						<p className="text-xs text-white/40 mt-1">{t('visibility.receiptsSubtitle', { count: receipts.length })}</p>
					</div>
					<Button type="button" variant="ghost" size="sm" onClick={onClose} className="shrink-0" autoFocus>
						{t('visibility.runDetailClose')}
					</Button>
				</div>

				<div className="overflow-y-auto flex-1 px-5 py-4 space-y-5 overscroll-contain">
					{receipts.length === 0 && <p className="text-sm text-white/40">{t('visibility.receiptsEmpty')}</p>}
					{receipts.map(({ run, promptText }) => (
						<AnswerReceiptCard key={run.id} run={run} promptText={promptText} />
					))}
				</div>
			</div>
		</div>
	);
}

function parseCitedSources(raw: unknown): ReceiptCitation[] {
	if (!Array.isArray(raw)) return [];
	const out: ReceiptCitation[] = [];
	for (const item of raw) {
		if (!item || typeof item !== 'object') continue;
		const o = item as Record<string, unknown>;
		out.push({
			url: typeof o['url'] === 'string' ? o['url'] : null,
			domain: typeof o['domain'] === 'string' ? o['domain'] : null,
			title: typeof o['title'] === 'string' ? o['title'] : null,
		});
	}
	return out;
}

function providerName(key: string, t: ReturnType<typeof useTranslation>['t']): string {
	const k = `visibility.provider_${key}`;
	const translate = t as (fullKey: string) => string;
	const translated = translate(k);
	return translated === k ? key : translated;
}

function AnswerReceiptCard({ run, promptText }: { run: VisibilityQueryRunRow; promptText: string }) {
	const { t } = useTranslation();
	const [open, setOpen] = useState(false);
	const citations = parseCitedSources(run.cited_sources);
	const when = new Date(run.run_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

	return (
		<article className="rounded-xl border border-white/[0.08] bg-white/[0.02] overflow-hidden">
			<button
				type="button"
				className="w-full text-left px-4 py-3 hover:bg-white/[0.03] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40"
				onClick={() => setOpen((v) => !v)}
				aria-expanded={open}
			>
				<div className="flex items-center justify-between gap-3">
					<p className="text-sm font-medium text-white truncate">{promptText || t('visibility.runDetailPrompt')}</p>
					<span className="shrink-0 text-[11px] text-violet-300 font-medium uppercase tracking-wide">
						{providerName(run.provider, t)}
					</span>
				</div>
				<p className="text-xs text-white/40 mt-1">{when}</p>
			</button>

			{open && (
				<div className="px-4 pb-4 pt-1 space-y-4 border-t border-white/[0.06]">
					<p className="text-sm text-white/80 whitespace-pre-wrap leading-relaxed">{run.answer_text}</p>

					<section>
						<h4 className="text-xs font-semibold text-white/40 uppercase tracking-wide mb-2">
							{t('visibility.receiptsCitedDomains')}
						</h4>
						{citations.length === 0 ? (
							<p className="text-xs text-white/40">{t('visibility.runDetailNoSources')}</p>
						) : (
							<ul className="flex flex-wrap gap-1.5">
								{citations.map((c, i) => {
									const label = c.domain ?? c.url ?? c.title;
									if (!label) return null;
									return (
										<li key={`${c.url ?? i}`}>
											<a
												href={hrefOf(c.url) ?? undefined}
												target="_blank"
												rel="noopener noreferrer nofollow"
												title={c.title ?? c.url ?? c.domain ?? undefined}
												className="inline-block rounded-full bg-white/[0.05] border border-white/[0.08] px-2.5 py-1 text-xs text-sky-300 hover:text-sky-200 hover:border-sky-400/30 transition-colors"
											>
												{label}
											</a>
										</li>
									);
								})}
							</ul>
						)}
					</section>
				</div>
			)}
		</article>
	);
}
