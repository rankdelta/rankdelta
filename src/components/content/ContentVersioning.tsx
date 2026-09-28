/**
 * Content Versioning & Collaboration Component
 * 
 * Advanced versioning with comments and collaboration features
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabaseClient';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { LoadingSpinner } from '../ui/LoadingSpinner';
import { useToast } from '../../hooks/useToast';
import { Toast } from '../ui/Toast';
import { EmptyState } from '../ui/EmptyState';
import { useAuth } from '../../hooks/useAuth';
import type { Content } from '../../types/database';

interface ContentVersioningProps {
	content: Content;
	/** Receives the restored body. */
	onVersionRestored?: (restoredBody: string) => void;
}

interface Revision {
	id: string;
	content_id: string;
	original_body: string;
	updated_body: string;
	changes: Record<string, unknown> | null;
	created_at: string;
	created_by?: string;
	comment?: string;
}

interface Comment {
	id: string;
	content_id: string;
	user_id: string;
	user_email?: string;
	comment: string;
	created_at: string;
	parent_id?: string;
}

export const ContentVersioning = ({ content, onVersionRestored }: ContentVersioningProps) => {
	const { t, i18n } = useTranslation();
	const { user } = useAuth();
	const [newComment, setNewComment] = useState('');
	const [isAddingComment, setIsAddingComment] = useState(false);
	const { toast, showToast, hideToast } = useToast();

	const { data: revisions, isLoading: revisionsLoading, refetch: refetchRevisions } = useQuery({
		queryKey: ['revisions', content.id],
		queryFn: async () => {
			const { data, error } = await supabase
				.from('revisions')
				.select('*')
				.eq('content_id', content.id)
				.order('created_at', { ascending: false });

			if (error) throw error;
			return (data || []) as Revision[];
		},
	});

	// Comments live in content_comments (owner-scoped RLS), not in content.metadata: a metadata
	// write from any other tool would otherwise overwrite them.
	const { data: comments, isLoading: commentsLoading, refetch: refetchComments } = useQuery({
		queryKey: ['content-comments', content.id],
		queryFn: async () => {
			const { data, error } = await supabase
				.from('content_comments')
				.select('id, content_id, user_id, comment_text, created_at')
				.eq('content_id', content.id)
				.order('created_at', { ascending: true });
			if (error) throw error;
			return (data ?? []).map((row) => ({
				id: row.id as string,
				content_id: row.content_id as string,
				user_id: row.user_id as string,
				user_email: row.user_id === user?.id ? user?.email : undefined,
				comment: row.comment_text as string,
				created_at: row.created_at as string,
			})) as Comment[];
		},
	});

	const handleAddComment = async () => {
		if (!newComment.trim() || !user) return;

		setIsAddingComment(true);
		try {
			const { error } = await supabase.from('content_comments').insert({
				content_id: content.id,
				user_id: user.id,
				comment_text: newComment.trim(),
			});

			if (error) throw error;

			setNewComment('');
			showToast(t('contentTools.versioning.toastCommentAdded'), 'success');
			await refetchComments();
		} catch (error) {
			console.error('Error adding comment:', error);
			showToast(t('contentTools.versioning.toastCommentError'), 'error');
		} finally {
			setIsAddingComment(false);
		}
	};

	const handleCreateRevision = async (comment?: string) => {
		try {
			const { error } = await supabase.from('revisions').insert({
				content_id: content.id,
				original_body: content.body,
				updated_body: content.body, // Current version
				changes: {
					comment,
					created_by: user?.email,
				},
			});

			if (error) throw error;
			showToast(t('contentTools.versioning.toastRevisionCreated'), 'success');
			refetchRevisions();
		} catch (error) {
			console.error('Error creating revision:', error);
			showToast(t('contentTools.versioning.toastRevisionError'), 'error');
		}
	};

	const handleRestoreRevision = async (revision: Revision) => {
		try {
			// Restoring overwrites the current text: keep it as a revision too, so a restore is undoable.
			const { error: snapErr } = await supabase.from('revisions').insert({
				content_id: content.id,
				original_body: content.body,
				updated_body: revision.original_body,
				changes: { source: 'restore', comment: 'Before restore', created_by: user?.email },
			});
			if (snapErr) throw snapErr;
			const { error } = await supabase
				.from('content')
				.update({
					body: revision.original_body,
					updated_at: new Date().toISOString(),
					metadata: {
						...(content.metadata ?? {}),
						restored_from: revision.id,
						restored_at: new Date().toISOString(),
					},
				})
				.eq('id', content.id);

			if (error) throw error;
			showToast(t('contentTools.versioning.toastRevisionRestored'), 'success');
			onVersionRestored?.(revision.original_body);
			void refetchRevisions();
		} catch (error) {
			console.error('Error restoring revision:', error);
			showToast(t('contentTools.versioning.toastRestoreError'), 'error');
		}
	};

	const getDiffStats = (original: string, updated: string) => {
		const originalWords = original.split(/\s+/).length;
		const updatedWords = updated.split(/\s+/).length;
		const wordDiff = updatedWords - originalWords;
		return {
			originalWords,
			updatedWords,
			wordDiff,
			percentChange: originalWords > 0 ? ((wordDiff / originalWords) * 100).toFixed(1) : '0',
		};
	};

	if (revisionsLoading || commentsLoading) {
		return <LoadingSpinner text={t('contentTools.versioning.loading')} />;
	}

	return (
		<div className="space-y-6">
			<Card>
				<div className="flex items-center justify-between mb-4">
					<h3 className="text-lg font-bold text-white">Versioning & Collaboration</h3>
					<Button variant="secondary" size="sm" onClick={() => handleCreateRevision()}>
						📸 {t('contentTools.versioning.createSnapshot')}
					</Button>
				</div>
				<p className="text-sm text-gray-400 mb-4">
					{t('contentTools.versioning.description')}
				</p>
			</Card>

			{/* Comments Section */}
			<Card>
				<h4 className="text-md font-semibold text-white mb-4">{t('contentTools.versioning.commentsTitle')}</h4>
				<div className="space-y-4">
					<div className="flex gap-2">
						<input
							type="text"
							value={newComment}
							onChange={(e) => setNewComment(e.target.value)}
							placeholder={t('emptyStates.addCommentPlaceholder')}
							className="flex-1 px-4 py-2 bg-cosmic-dark border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-cosmic-cyan text-white"
							onKeyPress={(e) => {
								if (e.key === 'Enter' && !e.shiftKey) {
									e.preventDefault();
									handleAddComment();
								}
							}}
						/>
						<Button
							variant="primary"
							size="sm"
							onClick={handleAddComment}
							loading={isAddingComment}
							disabled={!newComment.trim()}
						>
							{t('contentTools.versioning.send')}
						</Button>
					</div>

					{comments && comments.length > 0 ? (
						<div className="space-y-3">
							{comments.map((comment) => (
								<div key={comment.id} className="p-3 bg-gray-800 rounded-lg">
									<div className="flex items-start justify-between mb-2">
										<div>
											<p className="text-sm font-semibold text-white">
												{comment.user_email || t('contentTools.versioning.unknownUser')}
											</p>
											<p className="text-xs text-gray-400">
												{new Date(comment.created_at).toLocaleString(i18n.language)}
											</p>
										</div>
									</div>
									<p className="text-sm text-gray-300">{comment.comment}</p>
								</div>
							))}
						</div>
					) : (
						<p className="text-sm text-gray-400 text-center py-4">{t('emptyStates.noComments')}</p>
					)}
				</div>
			</Card>

			{/* Revisions Section */}
			<Card>
				<h4 className="text-md font-semibold text-white mb-4">{t('contentTools.versioning.versionsTitle', { n: revisions?.length || 0 })}</h4>
				{revisions && revisions.length > 0 ? (
					<div className="space-y-4">
						{revisions.map((revision) => {
							const stats = getDiffStats(revision.original_body, revision.updated_body);
							return (
								<div key={revision.id} className="p-4 bg-gray-800 rounded-lg border border-gray-700">
									<div className="flex items-start justify-between mb-3">
										<div>
											<p className="text-sm font-semibold text-white">
												{t('contentTools.versioning.versionFrom', { date: new Date(revision.created_at).toLocaleString(i18n.language) })}
											</p>
											{(revision.changes as any)?.created_by && (
												<p className="text-xs text-gray-400">
													{t('contentTools.versioning.createdBy', { name: (revision.changes as any).created_by })}
												</p>
											)}
										</div>
										<Button
											variant="secondary"
											size="sm"
											onClick={() => handleRestoreRevision(revision)}
										>
											↩️ {t('contentTools.versioning.restore')}
										</Button>
									</div>
									<div className="flex items-center gap-4 text-xs text-gray-400 mb-3">
										<span>
											{t('contentTools.versioning.wordsDiff', {
												from: stats.originalWords,
												to: stats.updatedWords,
												diff: `${stats.wordDiff > 0 ? '+' : ''}${stats.wordDiff}`,
											})}
										</span>
										<span>{t('contentTools.versioning.change', { pct: stats.percentChange })}</span>
									</div>
									{(revision.changes as any)?.comment && (
										<div className="p-2 bg-cosmic-cyan/10 border border-cosmic-cyan/30 rounded text-xs text-cosmic-cyan">
											{(revision.changes as any).comment}
										</div>
									)}
									<div className="mt-3 max-h-32 overflow-y-auto">
										<pre className="text-xs text-gray-400 font-mono whitespace-pre-wrap">
											{revision.original_body.substring(0, 300)}
											{revision.original_body.length > 300 ? '...' : ''}
										</pre>
									</div>
								</div>
							);
						})}
					</div>
				) : (
					<EmptyState
						icon="📸"
						title={t('emptyStates.noVersionsTitle')}
						description={t('emptyStates.noVersionsDesc')}
						variant="minimal"
					/>
				)}
			</Card>

			<Toast message={toast.message} type={toast.type} isVisible={toast.isVisible} onClose={hideToast} />
		</div>
	);
};

