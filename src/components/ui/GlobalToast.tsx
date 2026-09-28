/**
 * Global (imperative) toast — a module-level emitter plus a tiny host component mounted once in App.
 * Lets non-React code (e.g. the react-query MutationCache) surface a toast without a hook.
 */

import { useEffect } from 'react';
import { Toast, type ToastType } from './Toast';
import { useToast } from '../../hooks/useToast';

type Listener = (message: string, type: ToastType) => void;

let listener: Listener | null = null;

export const showGlobalToast = (message: string, type: ToastType = 'info'): void => {
	listener?.(message, type);
};

export const GlobalToastHost = () => {
	const { toast, showToast, hideToast } = useToast();

	useEffect(() => {
		listener = showToast;
		return () => {
			if (listener === showToast) listener = null;
		};
	}, [showToast]);

	return <Toast message={toast.message} type={toast.type} isVisible={toast.isVisible} onClose={hideToast} />;
};
