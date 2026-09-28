/**
 * Input Validation Utilities
 * 
 * Security: Always validate and sanitize user input
 */

/**
 * Sanitize string input to prevent XSS
 */
export const sanitizeString = (input: string): string => {
	if (typeof input !== 'string') {
		return '';
	}

	// Remove potentially dangerous characters
	return input
		.replace(/[<>]/g, '') // Remove < and >
		.replace(/javascript:/gi, '') // Remove javascript: protocol
		.replace(/on\w+=/gi, '') // Remove event handlers
		.trim()
		.slice(0, 10000); // Limit length
};

/**
 * Validate email format
 */
export const isValidEmail = (email: string): boolean => {
	if (!email || typeof email !== 'string') {
		return false;
	}

	const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
	return emailRegex.test(email) && email.length <= 254;
};

/**
 * Password policy — MUST mirror the Supabase Auth settings
 * (Authentication → Sign In / Providers → Passwords):
 *   • Minimum length 8
 *   • Requires lowercase, uppercase, digit AND symbol
 * If you change the policy in the Supabase dashboard, update these checks too,
 * otherwise the client accepts a password the server then rejects with a cryptic error.
 */
export const PASSWORD_MIN_LENGTH = 8;

export interface PasswordChecks {
	minLength: boolean;
	lowercase: boolean;
	uppercase: boolean;
	digit: boolean;
	symbol: boolean;
}

/**
 * Evaluate a password against every policy rule individually.
 * Used to drive the live "requirements" checklist in the signup / reset forms.
 */
export const getPasswordChecks = (password: string): PasswordChecks => {
	const pwd = typeof password === 'string' ? password : '';
	return {
		minLength: pwd.length >= PASSWORD_MIN_LENGTH,
		lowercase: /[a-z]/.test(pwd),
		uppercase: /[A-Z]/.test(pwd),
		digit: /\d/.test(pwd),
		// Anything that isn't a letter, digit or whitespace counts as a symbol.
		symbol: /[^A-Za-z0-9\s]/.test(pwd),
	};
};

/**
 * Validate password strength against the full Supabase policy.
 */
export const isValidPassword = (password: string): boolean => {
	if (!password || typeof password !== 'string') {
		return false;
	}

	const checks = getPasswordChecks(password);
	return checks.minLength && checks.lowercase && checks.uppercase && checks.digit && checks.symbol;
};

/**
 * Validate URL format
 */
export const isValidURL = (url: string): boolean => {
	if (!url || typeof url !== 'string') {
		return false;
	}

	try {
		const parsed = new URL(url);
		return ['http:', 'https:'].includes(parsed.protocol);
	} catch {
		return false;
	}
};

/**
 * Validate keyword input
 */
export const isValidKeyword = (keyword: string): boolean => {
	if (!keyword || typeof keyword !== 'string') {
		return false;
	}

	// Keywords should be 2-100 characters: letters (any script, accents included), digits, spaces, apostrophes, hyphens
	const sanitized = sanitizeString(keyword);
	return sanitized.length >= 2 && sanitized.length <= 100 && /^[\p{L}\p{N}\s'’-]+$/u.test(sanitized);
};

/**
 * Validate project name
 */
export const isValidProjectName = (name: string): boolean => {
	if (!name || typeof name !== 'string') {
		return false;
	}

	const sanitized = sanitizeString(name);
	return sanitized.length >= 1 && sanitized.length <= 255;
};

/**
 * Rate limiting helper (client-side check)
 * Note: Real rate limiting should be done on the backend
 */
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

export const checkRateLimit = (key: string, maxRequests: number = 10, windowMs: number = 60000): boolean => {
	const now = Date.now();
	const record = rateLimitStore.get(key);

	if (!record || now > record.resetTime) {
		rateLimitStore.set(key, { count: 1, resetTime: now + windowMs });
		return true;
	}

	if (record.count >= maxRequests) {
		return false;
	}

	record.count++;
	return true;
};

