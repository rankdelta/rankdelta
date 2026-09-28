import type { MouseEvent, ReactNode } from 'react';
import { displayUrl, hostOf, hrefOf, pathOf } from '../../lib/seoUrls';

const linkCls = 'text-violet-300 hover:underline';

/** External page link. Stops row-click handlers so tables can stay clickable. */
export function ExtLink({
  href,
  children,
  className = linkCls,
  title,
}: {
  href?: string | null;
  children?: ReactNode;
  className?: string;
  title?: string;
}) {
  const url = hrefOf(href);
  if (!url) return <span className="text-white/35">{children ?? '—'}</span>;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      title={title ?? url}
      onClick={(e: MouseEvent) => e.stopPropagation()}
    >
      {children ?? displayUrl(href)}
    </a>
  );
}

/**
 * Ahrefs-style referring/destination page: host on the first line, path beneath,
 * both open the real URL.
 */
export function PageLink({ href, muted = false }: { href?: string | null; muted?: boolean }) {
  const url = hrefOf(href);
  const host = hostOf(href);
  const path = pathOf(href);
  if (!url) return <span className="text-white/35">—</span>;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={url}
      onClick={(e: MouseEvent) => e.stopPropagation()}
      className="block min-w-0 max-w-full group"
    >
      <span className={`block truncate group-hover:underline ${muted ? 'text-white/70' : 'text-violet-300'}`}>
        {host || displayUrl(href)}
      </span>
      {path ? <span className="block truncate text-xs text-white/40">{path}</span> : null}
    </a>
  );
}
