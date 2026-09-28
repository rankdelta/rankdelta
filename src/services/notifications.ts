/**
 * Email Notifications Service
 * 
 * Handles email notifications for proposals, scheduled content, ranking changes
 */

import { supabase } from '../lib/supabaseClient';
import type { Ranking } from '../types/database';
import type { Content } from '../types/database';

/**
 * Minimal shape of a content proposal row needed for notifications.
 * Mirrors the `content_proposals` table columns consumed below.
 */
interface ContentProposal {
	id: string;
	project_id: string;
	title: string;
	primary_keyword: string;
}

export interface NotificationPreferences {
	proposals: boolean;
	scheduled_content: boolean;
	ranking_changes: boolean;
	content_updates: boolean;
	weekly_report: boolean;
}

export interface Notification {
	id: string;
	user_id: string;
	type: 'proposal' | 'scheduled_content' | 'ranking_change' | 'content_update' | 'weekly_report';
	title: string;
	message: string;
	read: boolean;
	created_at: string;
	metadata?: Record<string, unknown>;
}

/**
 * Get user notification preferences
 */
export const getUserNotificationPreferences = async (userId: string): Promise<NotificationPreferences> => {
	const { data, error } = await supabase
		.from('user_preferences')
		.select('notification_preferences')
		.eq('user_id', userId)
		.single();

	if (error && error.code !== 'PGRST116') {
		// PGRST116 = no rows returned
		console.error('Error fetching notification preferences:', error);
	}

	const defaultPreferences: NotificationPreferences = {
		proposals: true,
		scheduled_content: true,
		ranking_changes: true,
		content_updates: true,
		weekly_report: false,
	};

	return (data?.notification_preferences as NotificationPreferences) || defaultPreferences;
};

/**
 * Save user notification preferences
 */
export const saveNotificationPreferences = async (
	userId: string,
	preferences: NotificationPreferences
): Promise<void> => {
	const { error } = await supabase
		.from('user_preferences')
		.upsert({
			user_id: userId,
			notification_preferences: preferences,
			updated_at: new Date().toISOString(),
		});

	if (error) throw error;
};

/**
 * Send notification for new proposal
 */
export const notifyNewProposal = async (proposal: ContentProposal): Promise<void> => {
	// Get project owner
	const { data: project } = await supabase
		.from('projects')
		.select('user_id')
		.eq('id', proposal.project_id)
		.single();

	if (!project) return;

	const preferences = await getUserNotificationPreferences(project.user_id);
	if (!preferences.proposals) return;

	// Create notification
	await createNotification({
		user_id: project.user_id,
		type: 'proposal',
		title: 'Nuova Proposta di Contenuto',
		message: `Nuova proposta: "${proposal.title}" per la keyword "${proposal.primary_keyword}"`,
		metadata: {
			proposal_id: proposal.id,
			project_id: proposal.project_id,
		},
	});
};

/**
 * Send notification for scheduled content
 */
export const notifyScheduledContent = async (content: Content): Promise<void> => {
	if (!content.published_date) return;

	const publishedDate = new Date(content.published_date);
	const now = new Date();
	const daysUntilPublish = Math.floor((publishedDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

	// Notify 1 day before
	if (daysUntilPublish === 1) {
		const { data: project } = await supabase
			.from('projects')
			.select('user_id')
			.eq('id', content.project_id)
			.single();

		if (!project) return;

		const preferences = await getUserNotificationPreferences(project.user_id);
		if (!preferences.scheduled_content) return;

		await createNotification({
			user_id: project.user_id,
			type: 'scheduled_content',
			title: 'Contenuto in Pubblicazione Domani',
			message: `"${content.title}" sarà pubblicato domani`,
			metadata: {
				content_id: content.id,
				published_date: content.published_date,
			},
		});
	}
};

/**
 * Send notification for ranking changes
 */
export const notifyRankingChange = async (
	ranking: Ranking,
	previousPosition: number | null
): Promise<void> => {
	if (!previousPosition || !ranking.position) return;

	const positionChange = previousPosition - ranking.position;
	const significantChange = Math.abs(positionChange) >= 3;

	if (!significantChange) return;

	const { data: project } = await supabase
		.from('projects')
		.select('user_id')
		.eq('id', ranking.project_id)
		.single();

	if (!project) return;

	const preferences = await getUserNotificationPreferences(project.user_id);
	if (!preferences.ranking_changes) return;

	const isImprovement = positionChange > 0;
	await createNotification({
		user_id: project.user_id,
		type: 'ranking_change',
		title: isImprovement ? '🎉 Miglioramento Ranking!' : '⚠️ Ranking Diminuito',
		message: `Keyword "${ranking.keyword}": posizione ${previousPosition} → ${ranking.position} (${
			isImprovement ? '+' : ''
		}${positionChange})`,
		metadata: {
			ranking_id: ranking.id,
			keyword: ranking.keyword,
			previous_position: previousPosition,
			current_position: ranking.position,
			change: positionChange,
		},
	});
};

/**
 * Create a notification in the database
 */
const createNotification = async (notification: Omit<Notification, 'id' | 'read' | 'created_at'>): Promise<void> => {
	// In production, you'd have a notifications table
	// For now, we'll store in user_preferences or use a notifications table if it exists
	try {
		const { error } = await supabase.from('notifications').insert({
			...notification,
			read: false,
			created_at: new Date().toISOString(),
		});

		if (error) {
			// If notifications table doesn't exist, log it
			console.warn('Notifications table not available:', error);
		}
	} catch (error) {
		console.warn('Could not create notification:', error);
	}
};

/**
 * Get user notifications
 */
export const getUserNotifications = async (userId: string): Promise<Notification[]> => {
	try {
		const { data, error } = await supabase
			.from('notifications')
			.select('*')
			.eq('user_id', userId)
			.order('created_at', { ascending: false })
			.limit(50);

		if (error) {
			console.warn('Notifications table not available:', error);
			return [];
		}

		return (data || []) as Notification[];
	} catch (error) {
		console.warn('Could not fetch notifications:', error);
		return [];
	}
};

/**
 * Mark notification as read
 */
export const markNotificationAsRead = async (notificationId: string): Promise<void> => {
	const { error } = await supabase
		.from('notifications')
		.update({ read: true })
		.eq('id', notificationId);

	if (error) {
		console.warn('Could not mark notification as read:', error);
	}
};

