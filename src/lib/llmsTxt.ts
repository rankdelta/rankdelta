/**
 * llms.txt generator — Rankdelta's free GEO tool.
 *
 * Generates an `llms.txt` document (llmstxt.org convention) for any site: a
 * curated, Markdown map of the pages that matter to AI engines, so crawlers
 * and LLMs can find canonical, crawlable, AI-relevant content without
 * guessing. Pure functions only — no DB, no auth, no credits.
 *
 * Our own heuristics and copy: we score page importance from URL structure,
 * not by copying third-party tool claims.
 */

export type LlmsTxtSection = { title: string; pages: string[] };

export type LlmsTxtPage = {
	url: string;
	title: string;
	section: 'Docs' | 'Product' | 'Company' | 'Optional';
	reason: string;
};

export type LlmsTxtOptions = {
	siteUrl: string;
	siteName?: string;
	description?: string;
	pages: Array<{ url: string; title?: string }>;
};

/** Path segments that usually mark high-value marketing/product content (EN+IT). */
const HIGH_VALUE = [
	'pricing', 'prezzi', 'features', 'funzionalita', 'product', 'prodotto',
	'solutions', 'soluzioni', 'docs', 'documentation', 'documentazione',
	'guide', 'guida', 'guides', 'blog', 'faq', 'help', 'about', 'chi-siamo',
	'contact', 'contatti', 'tools', 'resources', 'risorse', 'demo', 'trial',
];

/** Segments that mark authenticated or low-value pages — never suggested as primary. */
const LOW_VALUE = [
	'login', 'signup', 'register', 'reset-password', 'forgot-password',
	'auth', 'admin', 'account', 'cart', 'checkout', 'wp-admin', 'private',
	'draft', 'staging', 'test', '404', '403', '500', 'callback', 'oauth',
];

const SECTION_BY_SEGMENT: Record<string, LlmsTxtPage['section']> = {
	docs: 'Docs', documentation: 'Docs', documentazione: 'Docs', guide: 'Docs',
	guida: 'Docs', guides: 'Docs', blog: 'Docs', faq: 'Docs', help: 'Docs',
	pricing: 'Product', prezzi: 'Product', features: 'Product',
	funzionalita: 'Product', product: 'Product', prodotto: 'Product',
	solutions: 'Product', soluzioni: 'Product', demo: 'Product', trial: 'Product',
	about: 'Company', 'chi-siamo': 'Company', contact: 'Company',
	contatti: 'Company',
};

/** Title-case a slug segment into readable words. */
export function slugToTitle(slug: string): string {
	return slug
		.split(/[-_]/)
		.filter(Boolean)
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(' ');
}

function classify(pathname: string): LlmsTxtPage['section'] | null {
	const segs = pathname.toLowerCase().split('/').filter(Boolean);
	if (segs.some((s) => LOW_VALUE.includes(s))) return null;
	if (segs.length === 0) return 'Product'; // homepage is always primary
	for (const seg of segs) {
		const mapped = SECTION_BY_SEGMENT[seg];
		if (mapped) return mapped;
	}
	if (segs.some((s) => HIGH_VALUE.includes(s))) return 'Product';
	// Deep content paths (e.g. blog slugs) are Optional unless matched above.
	return 'Optional';
}

export function makeReason(pathname: string): string {
	const segs = pathname.toLowerCase().split('/').filter(Boolean);
	if (segs.length === 0) return 'Canonical homepage and entry point for AI crawlers.';
	if (LOW_VALUE.some((s) => segs.includes(s))) return 'Excluded: authenticated or non-content page.';
	const last = segs[segs.length - 1];
	if (last && (last === 'pricing' || last === 'prezzi')) return 'Commercial offering — pricing context for purchase-intent queries.';
	const mapped = last ? SECTION_BY_SEGMENT[last] : undefined;
	if (mapped === 'Docs' || segs.some((s) => SECTION_BY_SEGMENT[s] === 'Docs'))
		return 'Reference content — authoritative answers for AI retrieval.';
	return `Content page — ${slugToTitle(last || '').toLowerCase()}.`;
}

/** Build the full page list: deduped, same-origin only, classified and ordered. */
export function buildLlmsTxtPages(opts: LlmsTxtOptions): {
	included: LlmsTxtPage[];
	excluded: number;
} {
	let origin: URL;
	try {
		origin = new URL(opts.siteUrl.startsWith('http') ? opts.siteUrl : `https://${opts.siteUrl}`);
	} catch {
		throw new Error('Invalid site URL');
	}

	const seen = new Set<string>();
	const included: LlmsTxtPage[] = [];
	let excluded = 0;

	for (const raw of opts.pages) {
		let u: URL;
		try {
			u = new URL(raw.url);
		} catch {
			excluded += 1;
			continue;
		}
		const key = `${u.origin}${u.pathname.replace(/\/+$/, '') || '/'}`;
		if (
			u.origin !== origin.origin ||
			seen.has(key) ||
			/\.(jpg|jpeg|png|gif|svg|pdf|zip|webp|ico|css|js|xml|json)$/i.test(u.pathname)
		) {
			excluded += 1;
			continue;
		}
		seen.add(key);
		const section = classify(u.pathname);
		if (!section) {
			excluded += 1;
			continue;
		}
		const title =
			raw.title?.trim() ||
			(u.pathname === '/' ? 'Home' : slugToTitle(u.pathname.split('/').filter(Boolean).pop() || ''));
		included.push({
			url: key,
			title,
			section,
			reason: makeReason(u.pathname),
		});
	}

	const order: Record<LlmsTxtPage['section'], number> = { Docs: 0, Product: 1, Company: 2, Optional: 3 };
	included.sort((a, b) => order[a.section] - order[b.section] || a.url.localeCompare(b.url));
	return { included, excluded };
}

/** Render the final llms.txt document (llmstxt.org block format). */
export function renderLlmsTxt(opts: LlmsTxtOptions): string {
	const origin = new URL(opts.siteUrl.startsWith('http') ? opts.siteUrl : `https://${opts.siteUrl}`);
	const name = opts.siteName?.trim() || origin.hostname.replace(/^www\./, '');
	const { included } = buildLlmsTxtPages(opts);

	const lines: string[] = [`# ${name}`];
	if (opts.description?.trim()) lines.push('', `> ${opts.description.trim()}`);

	const sections: LlmsTxtPage['section'][] = ['Docs', 'Product', 'Company', 'Optional'];
	for (const section of sections) {
		const pages = included.filter((p) => p.section === section);
		if (pages.length === 0) continue;
		lines.push('', `## ${section}`, '');
		for (const p of pages) {
			lines.push(`- [${p.title}](${p.url}): ${p.reason}`);
		}
	}
	return lines.join('\n') + '\n';
}
