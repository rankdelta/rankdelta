/**
 * Onboarding Hook
 * 
 * Manages onboarding state and progress tracking
 */

import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabaseClient';

export interface OnboardingProgress {
	hasCompletedWizard: boolean;
	hasCreatedProject: boolean;
	hasDoneKeywordResearch: boolean;
	hasGeneratedContent: boolean;
	lastCompletedStep?: string;
}

/**
 * Get onboarding progress for current user
 */
export const useOnboardingProgress = () => {
	return useQuery({
		queryKey: ['onboarding', 'progress'],
		queryFn: async () => {
			const {
				data: { user },
			} = await supabase.auth.getUser();

			if (!user) return null;

			// Check if user has projects
			const { data: projects } = await supabase
				.from('projects')
				.select('id')
				.eq('user_id', user.id)
				.limit(1);

			const hasCreatedProject = (projects?.length || 0) > 0;

			// Check if user has done keyword research (has clusters or keywords)
			let hasDoneKeywordResearch = false;
			if (hasCreatedProject && projects && projects[0]) {
				const { data: keywords } = await supabase
					.from('keywords')
					.select('id')
					.eq('project_id', projects[0].id)
					.limit(1);
				hasDoneKeywordResearch = (keywords?.length || 0) > 0;
			}

			// Check if user has generated content
			let hasGeneratedContent = false;
			if (hasCreatedProject && projects && projects[0]) {
				const { data: content } = await supabase
					.from('content')
					.select('id')
					.eq('project_id', projects[0].id)
					.limit(1);
				hasGeneratedContent = (content?.length || 0) > 0;
			}

			// Check localStorage for wizard completion
			const hasCompletedWizard = localStorage.getItem('onboarding_wizard_completed') === 'true';

			return {
				hasCompletedWizard,
				hasCreatedProject,
				hasDoneKeywordResearch,
				hasGeneratedContent,
			} as OnboardingProgress;
		},
	});
};

/**
 * Mark onboarding wizard as completed
 */
export const useCompleteOnboardingWizard = () => {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async () => {
			localStorage.setItem('onboarding_wizard_completed', 'true');
			return true;
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['onboarding'] });
		},
	});
};

/**
 * Hook to manage onboarding wizard state
 */
export const useOnboardingWizard = () => {
	const queryClient = useQueryClient();
	const { data: progress } = useOnboardingProgress();
	const [isOpen, setIsOpen] = useState(false);
	// Once the user completes/skips, never auto-reopen — the progress refetch is async and would
	// otherwise still report hasCompletedWizard=false for a moment after we closed the wizard.
	const dismissedRef = useRef(false);

	useEffect(() => {
		// Show wizard if user hasn't completed it
		if (progress && !progress.hasCompletedWizard && !dismissedRef.current) {
			setIsOpen(true);
		}
	}, [progress]);

	const completeWizard = useCompleteOnboardingWizard();

	const markCompleted = async () => {
		await completeWizard.mutateAsync();
		dismissedRef.current = true;
		// Update the cache synchronously so no consumer sees hasCompletedWizard=false while the
		// invalidated query refetches.
		queryClient.setQueryData<OnboardingProgress | null | undefined>(['onboarding', 'progress'], (prev) =>
			prev ? { ...prev, hasCompletedWizard: true } : prev,
		);
		setIsOpen(false);
	};

	const handleComplete = async () => {
		await markCompleted();
	};

	const handleSkip = async () => {
		await markCompleted();
	};

	return {
		isOpen,
		progress,
		handleComplete,
		handleSkip,
		openWizard: () => setIsOpen(true),
	};
};

