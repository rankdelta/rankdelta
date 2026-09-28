/**
 * MCP OAuth consent: naming the app that receives the access (see McpAuthorizePage).
 */

const KNOWN_APPS: Record<string, string> = {
	'claude.ai': 'Claude',
	'claude.com': 'Claude',
	'chatgpt.com': 'ChatGPT',
	'chat.openai.com': 'ChatGPT',
	'cursor.com': 'Cursor',
	'www.cursor.com': 'Cursor',
};

/**
 * Who receives the access: the app behind the redirect_uri the MCP server sends the code to.
 * Consent phishing works by getting someone to approve a connection another person set up in their
 * own ChatGPT/Claude, so the page names the app and the host instead of "An AI assistant".
 */
export function describeRedirect(uri: string | null): { app: string; host: string } | null {
	if (!uri) return null;
	try {
		const u = new URL(uri);
		const host = u.hostname.toLowerCase();
		if (host === 'localhost' || host === '127.0.0.1') return { app: 'An app on this computer', host: u.host };
		return { app: KNOWN_APPS[host] ?? host, host };
	} catch {
		return null;
	}
}
