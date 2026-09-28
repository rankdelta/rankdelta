/**
 * White-label client report branding (skeleton).
 * Stored in projects.metadata.white_label_report — no migration required.
 * Full agency UI (logo upload, colors) is PROPOSTA; this reads optional fields when set.
 */

import type { Project } from '../types/database';

export interface WhiteLabelReportBranding {
	agencyName: string | null;
	logoUrl: string | null;
	primaryColor: string;
	hideAstroSeoFooter: boolean;
	enabled: boolean;
}

export function getWhiteLabelBranding(
	project: Pick<Project, 'metadata'> | null | undefined,
	planWhiteLabel?: boolean,
): WhiteLabelReportBranding {
	const raw = project?.metadata?.['white_label_report'];
	const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
	const agencyName = typeof o['agencyName'] === 'string' && o['agencyName'].trim() ? o['agencyName'].trim() : null;
	const logoUrl = typeof o['logoUrl'] === 'string' && /^https?:\/\//i.test(o['logoUrl']) ? o['logoUrl'].trim() : null;
	const primaryColor =
		typeof o['primaryColor'] === 'string' && /^#[0-9a-f]{3,8}$/i.test(o['primaryColor'])
			? o['primaryColor']
			: '#7c3aed';
	const hideAstroSeoFooter = o['hideAstroSeoFooter'] === true || planWhiteLabel === true;
	return {
		agencyName,
		logoUrl,
		primaryColor,
		hideAstroSeoFooter,
		enabled: !!(agencyName || logoUrl || planWhiteLabel),
	};
}
