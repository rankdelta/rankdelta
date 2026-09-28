/**
 * Inline Citation Optimizer Component
 * 
 * Ottimizza il contenuto per essere citato con inline links negli AI Overviews.
 * Basato su ciò che Liz Reid ha rivelato: "According to Bold Names, here's what they have to say"
 * 
 * Obiettivo: Creare contenuto che Google può citare con:
 * - Brand mention + link
 * - Affermazioni autorevoli ed esperte
 * - Definizioni chiare e quotabili
 */

import { useMemo, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import type { Content } from '../../types/database';

interface InlineCitationOptimizerProps {
	content: Content;
}

interface CitationOpportunity {
	type: 'definition' | 'statistic' | 'expert_quote' | 'actionable_tip' | 'comparison';
	title: string;
	description: string;
	example: string;
	present: boolean;
	count: number;
}

export const InlineCitationOptimizer = ({ content }: InlineCitationOptimizerProps): ReactElement => {
	const { t } = useTranslation();
	const analysis = useMemo(() => {
		const body = content.body || '';
		
		const opportunities: Array<CitationOpportunity> = [];
		
		// 1. DEFINIZIONI CHIARE
		// Patterns: "X is a/an...", "X refers to...", "X means..."
		const definitionPatterns = [
			/\b\w+\s+is\s+(a|an|the)\s+[^.]{10,60}\./gi,
			/\b\w+\s+refers?\s+to\s+[^.]{10,60}\./gi,
			/\b\w+\s+means?\s+[^.]{10,60}\./gi,
			/defined as\s+[^.]{10,60}\./gi,
			// Italian
			/\b\w+\s+è\s+(un|una|uno|il|la|lo|l')\s*[^.]{10,60}\./gi,
			/\b\w+\s+(si riferisce a|indica|significa)\s+[^.]{10,60}\./gi,
			/(si definisce|definito come|definita come)\s+[^.]{10,60}\./gi,
		];
		const definitionCount = definitionPatterns.reduce((sum, pattern) => {
			return sum + (body.match(pattern) || []).length;
		}, 0);
		
		opportunities.push({
			type: 'definition',
			title: t('contentTools.inlineCitation.opportunities.definition.title'),
			description: t('contentTools.inlineCitation.opportunities.definition.description'),
			example: '"SEO is the practice of optimizing websites to rank higher in search results."',
			present: definitionCount >= 2,
			count: definitionCount,
		});
		
		// 2. STATISTICHE E DATI
		const statisticPatterns = [
			/\d+%\s+of\s+/gi,
			/\d+\s+(out of|in)\s+\d+/gi,
			/according to\s+(our|the|a)\s+(data|research|study|survey)/gi,
			/studies?\s+show/gi,
			/research\s+(indicates?|shows?|reveals?)/gi,
			// Italian
			/\d+\s*%\s+(dei|delle|degli|di)\s+/gi,
			/\d+\s+su\s+\d+/gi,
			/secondo\s+(i dati|la ricerca|uno studio|un sondaggio|i nostri dati)/gi,
			/(gli studi|le ricerche|la ricerca)\s+(mostrano|mostra|indicano|indica|rivelano|rivela)/gi,
		];
		const statisticCount = statisticPatterns.reduce((sum, pattern) => {
			return sum + (body.match(pattern) || []).length;
		}, 0);
		
		opportunities.push({
			type: 'statistic',
			title: t('contentTools.inlineCitation.opportunities.statistic.title'),
			description: t('contentTools.inlineCitation.opportunities.statistic.description'),
			example: '"According to our research, 78% of users prefer mobile-first designs."',
			present: statisticCount >= 3,
			count: statisticCount,
		});
		
		// 3. CITAZIONI ESPERTE
		const expertPatterns = [
			/experts?\s+(say|recommend|suggest|advise)/gi,
			/according to\s+\w+\s+(experts?|specialists?|professionals?)/gi,
			/as\s+(a|an)\s+(expert|specialist|professional)\s+(in|with)/gi,
			/based on\s+(my|our)\s+(experience|expertise)/gi,
			/in\s+(my|our)\s+professional\s+opinion/gi,
			// Italian
			/(gli )?esperti\s+(dicono|consigliano|suggeriscono|raccomandano)/gi,
			/secondo\s+(gli|i)\s+(esperti|specialisti|professionisti)/gi,
			/(in base alla|dalla)\s+(mia|nostra)\s+esperienza/gi,
			/(a mio|a nostro)\s+(parere|avviso)\s+professionale/gi,
		];
		const expertCount = expertPatterns.reduce((sum, pattern) => {
			return sum + (body.match(pattern) || []).length;
		}, 0);
		
		opportunities.push({
			type: 'expert_quote',
			title: t('contentTools.inlineCitation.opportunities.expertQuote.title'),
			description: t('contentTools.inlineCitation.opportunities.expertQuote.description'),
			example: '"Based on our 10 years of experience in SEO, we recommend..."',
			present: expertCount >= 2,
			count: expertCount,
		});
		
		// 4. CONSIGLI ACTIONABLE
		const actionablePatterns = [
			/the\s+(best|most effective|recommended)\s+way\s+to/gi,
			/here('s| is)\s+(how|what)\s+to/gi,
			/to\s+(get|achieve|improve)\s+[^,]+,\s+(you should|we recommend)/gi,
			/pro tip:/gi,
			/key takeaway:/gi,
			/bottom line:/gi,
			// Italian
			/il\s+(modo migliore|metodo più efficace|modo consigliato)\s+per/gi,
			/ecco\s+(come|cosa)\s+/gi,
			/(consiglio pratico|in sintesi|in breve|punto chiave):/gi,
			/ti\s+(consigliamo|consiglio)\s+di/gi,
		];
		const actionableCount = actionablePatterns.reduce((sum, pattern) => {
			return sum + (body.match(pattern) || []).length;
		}, 0);
		
		opportunities.push({
			type: 'actionable_tip',
			title: t('contentTools.inlineCitation.opportunities.actionableTip.title'),
			description: t('contentTools.inlineCitation.opportunities.actionableTip.description'),
			example: '"The best way to improve SEO is to focus on user experience first."',
			present: actionableCount >= 3,
			count: actionableCount,
		});
		
		// 5. COMPARAZIONI E CONTRASTI
		const comparisonPatterns = [
			/unlike\s+[^,]+,\s+/gi,
			/compared\s+to\s+/gi,
			/the\s+difference\s+between\s+/gi,
			/while\s+[^,]+\s+is\s+[^,]+,\s+[^.]+\s+is\s+/gi,
			/vs\.?|versus/gi,
			// Italian
			/a differenza\s+(di|del|della|dei|delle)\s+/gi,
			/(rispetto a|confrontato con|in confronto a)\s+/gi,
			/la\s+differenza\s+tra\s+/gi,
		];
		const comparisonCount = comparisonPatterns.reduce((sum, pattern) => {
			return sum + (body.match(pattern) || []).length;
		}, 0);
		
		opportunities.push({
			type: 'comparison',
			title: t('contentTools.inlineCitation.opportunities.comparison.title'),
			description: t('contentTools.inlineCitation.opportunities.comparison.description'),
			example: '"Unlike traditional SEO, GEO focuses on optimizing for AI-generated summaries."',
			present: comparisonCount >= 2,
			count: comparisonCount,
		});
		
		// Calculate overall citation score
		const presentCount = opportunities.filter((o) => o.present).length;
		const totalPossible = opportunities.length;
		const citationScore = Math.round((presentCount / totalPossible) * 100);
		
		return {
			opportunities,
			citationScore,
			presentCount,
			totalPossible,
		};
	}, [content, t]);
	
	return (
		<div className="space-y-6">
			{/* Header */}
			<Card className="bg-gradient-to-r from-amber-500/20 to-orange-500/20 border-amber-500/30">
				<div className="flex items-center gap-4 mb-4">
					<div className="text-4xl">📎</div>
					<div>
						<h3 className="text-xl font-bold text-gray-900">Inline Citation Optimizer</h3>
						<p className="text-sm text-gray-600">
							{t('contentTools.inlineCitation.subtitle')}
						</p>
					</div>
				</div>
				<p className="text-xs text-gray-500 leading-relaxed">
					{t('contentTools.inlineCitation.intro')}
				</p>
			</Card>
			
			{/* Citation Score */}
			<Card>
				<div className="flex items-center justify-between mb-4">
					<h4 className="font-bold text-gray-900">Citation Readiness Score</h4>
					<Badge 
						size="md"
						variant={analysis.citationScore >= 80 ? 'success' : analysis.citationScore >= 60 ? 'warning' : 'error'}
					>
						{analysis.citationScore}%
					</Badge>
				</div>
				<div className="w-full bg-gray-200 rounded-full h-3 mb-3">
					<div
						style={{ width: `${analysis.citationScore}%` }}
						className={`h-3 rounded-full transition-all ${
							analysis.citationScore >= 80 ? 'bg-cosmic-green' :
							analysis.citationScore >= 60 ? 'bg-amber-500' : 'bg-red-500'
						}`}
					/>
				</div>
				<p className="text-xs text-gray-500">
					{t('contentTools.inlineCitation.typesPresent', { present: analysis.presentCount, total: analysis.totalPossible })}
				</p>
			</Card>
			
			{/* Citation Opportunities */}
			<div className="space-y-3">
				{analysis.opportunities.map((opportunity) => (
					<Card 
						key={opportunity.type}
						className={`border-l-4 ${opportunity.present ? 'border-l-cosmic-green bg-cosmic-green/5' : 'border-l-amber-500 bg-amber-500/5'}`}
					>
						<div className="flex items-start justify-between gap-4">
							<div className="flex-1">
								<div className="flex items-center gap-2 mb-2">
									{opportunity.present ? (
										<span className="text-cosmic-green">✓</span>
									) : (
										<span className="text-amber-500">⚠</span>
									)}
									<h4 className="font-semibold text-gray-900">{opportunity.title}</h4>
									<Badge size="sm" variant={opportunity.present ? 'success' : 'warning'}>
										{t('contentTools.inlineCitation.found', { count: opportunity.count })}
									</Badge>
								</div>
								<p className="text-xs text-gray-600 mb-2">{opportunity.description}</p>
								<div className="p-2 bg-gray-100 rounded text-xs text-gray-700 italic">
									{t('contentTools.inlineCitation.example', { example: opportunity.example })}
								</div>
							</div>
						</div>
						
						{!opportunity.present && (
							<div className="mt-3 pt-3 border-t border-gray-200">
								<p className="text-xs text-amber-600">
									{t('contentTools.inlineCitation.suggestion')}
								</p>
							</div>
						)}
					</Card>
				))}
			</div>
			
			{/* Best Practices */}
			<Card className="bg-gray-50">
				<h4 className="font-bold text-gray-900 mb-3">{t('contentTools.inlineCitation.bestPractices.title')}</h4>
				<div className="grid md:grid-cols-2 gap-4 text-xs">
					<div>
						<p className="font-semibold text-cosmic-purple mb-2">{t('contentTools.inlineCitation.bestPractices.structureTitle')}</p>
						<ul className="space-y-1 text-gray-600">
							<li>{t('contentTools.inlineCitation.bestPractices.structure.definitions')}</li>
							<li>{t('contentTools.inlineCitation.bestPractices.structure.accordingTo')}</li>
							<li>{t('contentTools.inlineCitation.bestPractices.structure.statistics')}</li>
							<li>{t('contentTools.inlineCitation.bestPractices.structure.takeaways')}</li>
						</ul>
					</div>
					<div>
						<p className="font-semibold text-cosmic-cyan mb-2">{t('contentTools.inlineCitation.bestPractices.formatTitle')}</p>
						<ul className="space-y-1 text-gray-600">
							<li>{t('contentTools.inlineCitation.bestPractices.format.selfContained')}</li>
							<li>{t('contentTools.inlineCitation.bestPractices.format.definitive')}</li>
							<li>{t('contentTools.inlineCitation.bestPractices.format.specificNumbers')}</li>
							<li>{t('contentTools.inlineCitation.bestPractices.format.brandMention')}</li>
						</ul>
					</div>
				</div>
			</Card>
		</div>
	);
};

