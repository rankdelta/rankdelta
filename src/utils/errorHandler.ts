/**
 * Error Handler Utility
 * 
 * Centralized error handling with user-friendly messages
 */

export interface AppError {
	code: string;
	message: string;
	userMessage: string;
	severity: 'error' | 'warning' | 'info';
	retryable: boolean;
}

/**
 * Parse error and return user-friendly message
 */
export const handleError = (error: unknown): AppError => {
	// Handle Error objects
	if (error instanceof Error) {
		// Supabase errors
		if (error.message.includes('PGRST') || error.message.includes('Postgrest')) {
			if (error.message.includes('PGRST116')) {
				return {
					code: 'NOT_FOUND',
					message: error.message,
					userMessage: 'Risorsa non trovata',
					severity: 'warning',
					retryable: false,
				};
			}
			if (error.message.includes('PGRST301')) {
				return {
					code: 'UNAUTHORIZED',
					message: error.message,
					userMessage: 'Non autorizzato. Effettua il login.',
					severity: 'error',
					retryable: false,
				};
			}
			return {
				code: 'DATABASE_ERROR',
				message: error.message,
				userMessage: 'Errore nel database. Riprova più tardi.',
				severity: 'error',
				retryable: true,
			};
		}

		// Network errors
		if (error.message.includes('fetch') || error.message.includes('network') || error.message.includes('Network')) {
			return {
				code: 'NETWORK_ERROR',
				message: error.message,
				userMessage: 'Errore di connessione. Verifica la tua connessione internet.',
				severity: 'error',
				retryable: true,
			};
		}

		// API errors
		if (error.message.includes('API') || error.message.includes('key')) {
			return {
				code: 'API_ERROR',
				message: error.message,
				userMessage: 'Errore nell\'API. Verifica le configurazioni.',
				severity: 'error',
				retryable: true,
			};
		}

		// Rate limit errors
		if (error.message.includes('rate limit') || error.message.includes('too many')) {
			return {
				code: 'RATE_LIMIT',
				message: error.message,
				userMessage: 'Troppe richieste. Attendi un momento prima di riprovare.',
				severity: 'warning',
				retryable: true,
			};
		}

		// Validation errors
		if (error.message.includes('validation') || error.message.includes('invalid')) {
			return {
				code: 'VALIDATION_ERROR',
				message: error.message,
				userMessage: error.message, // Show validation message directly
				severity: 'warning',
				retryable: false,
			};
		}

		// Generic error
		return {
			code: 'UNKNOWN_ERROR',
			message: error.message,
			userMessage: 'Si è verificato un errore. Riprova più tardi.',
			severity: 'error',
			retryable: true,
		};
	}

	// Handle string errors
	if (typeof error === 'string') {
		return {
			code: 'STRING_ERROR',
			message: error,
			userMessage: error,
			severity: 'error',
			retryable: false,
		};
	}

	// Handle unknown errors
	return {
		code: 'UNKNOWN_ERROR',
		message: 'Unknown error',
		userMessage: 'Si è verificato un errore sconosciuto. Riprova più tardi.',
		severity: 'error',
		retryable: true,
	};
};

/**
 * Log error to console (and potentially to error tracking service)
 */
export const logError = (error: AppError, context?: string) => {
	if (import.meta.env.DEV) {
		console.error(`[${error.code}] ${context || 'Error'}:`, error.message);
	}
	// In production, send to error tracking service (e.g., Sentry)
	// if (import.meta.env.PROD) {
	//   sentry.captureException(error);
	// }
};

/**
 * Show error toast notification
 */
export const showErrorToast = (error: AppError, showToast: (message: string, type: 'error' | 'warning' | 'success' | 'info') => void) => {
	showToast(error.userMessage, error.severity === 'error' ? 'error' : 'warning');
};

/**
 * Handle error with full flow: parse, log, and show toast
 */
export const handleErrorWithToast = (
	error: unknown,
	showToast: (message: string, type: 'error' | 'warning' | 'success' | 'info') => void,
	context?: string
): AppError => {
	const appError = handleError(error);
	logError(appError, context);
	showErrorToast(appError, showToast);
	return appError;
};

