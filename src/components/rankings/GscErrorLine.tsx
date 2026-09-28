/**
 * Error banner for the Search Console panels.
 *
 * Renders any URL inside the message as a real link. That is not decoration:
 * the `no_refresh_token` case can only be resolved by the user removing the
 * app's access at https://myaccount.google.com/permissions, and an address they
 * have to retype by hand is an instruction most people will not follow.
 */
const URL_PATTERN = /(https?:\/\/[^\s]+[^\s.,;:)])/g;
const IS_URL = /^https?:\/\//;

export function GscErrorLine({ text }: { text: string }) {
	const parts = text.split(URL_PATTERN).filter((part) => part.length > 0);
	return (
		<div className="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-200">
			{parts.map((part, index) =>
				IS_URL.test(part) ? (
					<a
						key={index}
						className="underline decoration-rose-300/60 underline-offset-2 hover:text-white"
						href={part}
						rel="noopener noreferrer"
						target="_blank"
					>
						{part.replace(/^https?:\/\//, '')}
					</a>
				) : (
					<span key={index}>{part}</span>
				),
			)}
		</div>
	);
}
