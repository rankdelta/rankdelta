import { useEffect } from 'react';
import { Button } from './Button';

export interface ConfirmDialogProps {
	open: boolean;
	title: string;
	message: string;
	confirmLabel: string;
	cancelLabel: string;
	/** Style the confirm button as destructive. */
	danger?: boolean;
	/** Disable buttons + show a spinner while the action runs. */
	loading?: boolean;
	onConfirm: () => void;
	onCancel: () => void;
}

/**
 * In-app confirmation dialog — the replacement for native window.confirm(), which blocks the tab
 * (and hangs CDP/automation). Renders nothing when closed. Escape or a backdrop click cancels.
 */
export function ConfirmDialog({
	open,
	title,
	message,
	confirmLabel,
	cancelLabel,
	danger = false,
	loading = false,
	onConfirm,
	onCancel,
}: ConfirmDialogProps) {
	useEffect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape' && !loading) onCancel();
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [open, loading, onCancel]);

	if (!open) return null;

	return (
		<div
			className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
			role="dialog"
			aria-modal="true"
			aria-label={title}
			onClick={() => { if (!loading) onCancel(); }}
		>
			<div
				className="w-full max-w-md rounded-2xl border border-white/10 bg-[#161320] p-6 shadow-2xl"
				onClick={(e) => e.stopPropagation()}
			>
				<h2 className="text-lg font-semibold text-white">{title}</h2>
				<p className="mt-2 text-sm text-white/70">{message}</p>
				<div className="mt-6 flex justify-end gap-2">
					<Button type="button" variant="ghost" size="sm" disabled={loading} onClick={onCancel}>
						{cancelLabel}
					</Button>
					<Button
						type="button"
						variant={danger ? 'danger' : 'primary'}
						size="sm"
						loading={loading}
						disabled={loading}
						onClick={onConfirm}
					>
						{confirmLabel}
					</Button>
				</div>
			</div>
		</div>
	);
}
