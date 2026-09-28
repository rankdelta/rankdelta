/**
 * Dashboard Page
 * 
 * Main dashboard showing stats, recent activity, and quick actions.
 * Enhanced with onboarding guidance for new users.
 */

import { useEffect } from 'react';
import { useProjects } from '../hooks/useProjects';
import { useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '../components/ui/Button';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { OnboardingWizard } from '../components/onboarding/OnboardingWizard';
import { Sidebar } from '../components/layout/Sidebar';
import { CalendarContent } from '../components/calendar/CalendarContent';
import { useOnboardingWizard, useOnboardingProgress } from '../hooks/useOnboarding';
import { useContentProposals } from '../hooks/useContentProposals';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { resumeIncompleteGenerations } from '../services/proposalAutoGeneration';
import { getDefaultAuthenticatedHomePath } from '../config/productMode';

export const Dashboard = () => {
	const { t } = useTranslation();
	const { isLoading } = useProjects();
	const { data: progress } = useOnboardingProgress();
	const { data: proposals } = useContentProposals(undefined);
	const onboarding = useOnboardingWizard();
	const navigate = useNavigate();
	const queryClient = useQueryClient();

	// Resume incomplete generations on mount
	useEffect(() => {
		let isMounted = true;
		
		const resumeGenerations = async () => {
			try {
				await resumeIncompleteGenerations();
			} catch (error) {
				if (isMounted) {
					console.error('Error resuming generations:', error);
				}
			}
		};

		resumeGenerations();
		
		return () => {
			isMounted = false;
		};
	}, []);
	
	// Show notification if there are new proposals
	const pendingProposals = proposals?.filter((p) => p.status === 'pending').length || 0;

	const isNewUser = progress && !progress.hasCreatedProject;

	// The wizard auto-opens for new users inside useOnboardingWizard (single source of truth);
	// a second timer here re-opened it right after Skip while the progress query was refetching.

	// Show loading state while data is being fetched
	if (isLoading) {
		return (
			<div className="flex min-h-screen bg-gray-50">
				<Sidebar />
				<div className="flex-1 flex items-center justify-center">
					<LoadingSpinner />
				</div>
			</div>
		);
	}

	return (
		<div className="flex min-h-screen bg-gray-50">
			{/* Sidebar */}
			<Sidebar />

			<div className="flex-1 flex flex-col">
			{/* Onboarding Wizard */}
			<OnboardingWizard
				isOpen={onboarding?.isOpen || false}
				onComplete={async (_projectId, options) => {
					await onboarding.handleComplete();
					queryClient.invalidateQueries();
					if (options?.openMcpSettings) {
						navigate({ to: '/settings' as any, search: { tab: 'mcp' } as any });
					} else {
						navigate({ to: getDefaultAuthenticatedHomePath() as any });
					}
				}}
				onSkip={async () => {
					await onboarding.handleSkip();
				}}
			/>

				{/* Main Content */}
				<main className="flex-1 overflow-y-auto bg-white">
					{/* Header */}
					<header className="bg-white border-b border-gray-200 sticky top-0 z-40 shadow-sm">
				<div className="max-w-7xl mx-auto px-6 py-4">
					<div className="flex items-center justify-between">
						<div>
							<h1 className="text-2xl font-bold text-gray-900">{t('dashboard.title')}</h1>
							<p className="text-sm text-gray-500">{t('dashboard.subtitle')}</p>
						</div>
						<div className="flex items-center gap-3">
							{isNewUser && (
								<button
									onClick={onboarding.openWizard}
									className="px-4 py-2 bg-gradient-to-r from-teal-500 to-cyan-500 text-white rounded-xl hover:from-teal-600 hover:to-cyan-600 transition-all text-sm font-semibold shadow-md shadow-teal-500/20"
								>
									🚀 {t('dashboard.startHere')}
								</button>
							)}
							{!isNewUser && (
								<button
									onClick={() => navigate({ to: '/proposals' as any })}
									className="px-4 py-2 bg-gradient-to-r from-teal-500 to-cyan-500 text-white rounded-xl hover:from-teal-600 hover:to-cyan-600 transition-all text-sm font-semibold shadow-md shadow-teal-500/20 flex items-center gap-2"
								>
									✨ {t('dashboard.generateNewContent')}
								</button>
							)}
							{pendingProposals > 0 && (
								<button
									onClick={() => navigate({ to: '/proposals' as any })}
									className="px-4 py-2 bg-amber-50 border border-amber-200 text-amber-700 rounded-xl hover:bg-amber-100 transition-colors text-sm font-medium flex items-center gap-2"
								>
									⏳ {pendingProposals} {pendingProposals === 1 ? t('dashboard.pendingProposals') : t('dashboard.pendingProposalsPlural')}
								</button>
							)}
							<div className="flex items-center gap-2 text-sm text-gray-500">
								<span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span>
								<span>{t('dashboard.synchronized')}</span>
							</div>
						</div>
					</div>
				</div>
			</header>

				{/* Calendar Content or Empty State */}
				<div className="max-w-7xl mx-auto px-6 py-8">
					{isNewUser ? (
						<div className="text-center py-16">
							<motion.div
								initial={{ opacity: 0, y: 20 }}
								animate={{ opacity: 1, y: 0 }}
								className="max-w-2xl mx-auto"
							>
								<div className="text-6xl mb-6">🚀</div>
								<h2 className="text-3xl font-bold text-gray-900 mb-4">
									{t('dashboard.welcome')}
								</h2>
								<p className="text-lg text-gray-600 mb-8">
									{t('dashboard.welcomeDescription')}
								</p>
								<div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
									<div className="p-6 bg-white border border-gray-200 rounded-lg shadow-sm">
										<div className="text-3xl mb-3">🔍</div>
										<h3 className="font-semibold text-gray-900 mb-2">{t('dashboard.step1')}</h3>
										<p className="text-sm text-gray-600">
											{t('dashboard.step1Description')}
										</p>
									</div>
									<div className="p-6 bg-white border border-gray-200 rounded-lg shadow-sm">
										<div className="text-3xl mb-3">🗺️</div>
										<h3 className="font-semibold text-gray-900 mb-2">{t('dashboard.step2')}</h3>
										<p className="text-sm text-gray-600">
											{t('dashboard.step2Description')}
										</p>
									</div>
									<div className="p-6 bg-white border border-gray-200 rounded-lg shadow-sm">
										<div className="text-3xl mb-3">✍️</div>
										<h3 className="font-semibold text-gray-900 mb-2">{t('dashboard.step3')}</h3>
										<p className="text-sm text-gray-600">
											{t('dashboard.step3Description')}
										</p>
									</div>
								</div>
								<Button
									onClick={onboarding.openWizard}
									variant="primary"
									size="lg"
									className="text-lg px-8 py-4"
								>
									🚀 {t('dashboard.startHere')}
								</Button>
							</motion.div>
						</div>
					) : (
						<CalendarContent />
					)}
				</div>
				</main>
			</div>
		</div>
	);
};

