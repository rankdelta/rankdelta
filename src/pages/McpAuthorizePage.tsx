/**
 * MCP OAuth consent page. The mcp Edge Function redirects GET /authorize here (Supabase serves
 * function HTML as text/plain), the user pastes a personal API key, and the form posts back to the
 * MCP server's /authorize. The form target comes from the build config (mcpOAuthIssuerUrl), never
 * from the query string, so a crafted link cannot send the key elsewhere.
 */
import { useMemo } from 'react';
import { mcpOAuthIssuerUrl } from '../services/apiKeys';

const PASSTHROUGH = ['client_id', 'redirect_uri', 'state', 'code_challenge'] as const;

export function McpAuthorizePage({ search = typeof window !== 'undefined' ? window.location.search : '' }: { search?: string }) {
	const params = useMemo(() => new URLSearchParams(search), [search]);
	const error = params.get('error');
	const action = `${mcpOAuthIssuerUrl()}/authorize`;

	return (
		<div className="min-h-screen flex items-center justify-center bg-[#080808] p-6 text-white">
			<div className="w-full max-w-[420px] rounded-[20px] border border-white/10 bg-white/[0.03] p-7">
				<h1 className="mb-2 text-[22px] font-semibold">Connect Rankdelta</h1>
				<p className="text-sm leading-relaxed text-white/55">
					An AI assistant is requesting access to your SEO and AI-visibility tools. Paste a personal API key from{' '}
					<a href="/settings" target="_blank" rel="noopener" className="text-violet-300">
						Settings → API &amp; MCP
					</a>
					.
				</p>
				{error && (
					<p role="alert" className="mt-4 rounded-[10px] bg-red-900/30 px-3 py-2.5 text-sm text-red-300">
						{error}
					</p>
				)}
				<form method="POST" action={action}>
					{PASSTHROUGH.map((name) => (
						<input key={name} type="hidden" name={name} value={params.get(name) ?? ''} />
					))}
					<input type="hidden" name="code_challenge_method" value="S256" />
					<input type="hidden" name="response_type" value="code" />
					<input type="hidden" name="scope" value={params.get('scope') || 'mcp:tools'} />
					<label htmlFor="api_key" className="mb-1.5 mt-4 block text-xs text-white/45">
						API key (sk_rankdelta_…)
					</label>
					<input
						id="api_key"
						name="api_key"
						type="password"
						autoComplete="off"
						required
						placeholder="sk_rankdelta_…"
						className="w-full rounded-xl border border-white/10 bg-black/35 px-3.5 py-3 font-mono text-[13px] text-white"
					/>
					<button type="submit" className="mt-[18px] w-full rounded-full bg-violet-600 py-3 text-sm font-semibold hover:bg-violet-500">
						Authorize
					</button>
				</form>
			</div>
		</div>
	);
}
