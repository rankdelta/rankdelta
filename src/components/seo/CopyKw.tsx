import { useState } from 'react';

/** Copy the keyword — Ahrefs/Semrush row action, no navigation. */
export function CopyKw({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  if (!text) return null;
  return (
    <button
      type="button"
      className="text-[11px] text-white/35 hover:text-white/70"
      onClick={(e) => {
        e.stopPropagation();
        void navigator.clipboard?.writeText(text).then(() => {
          setOk(true);
          setTimeout(() => setOk(false), 1200);
        }).catch(() => {});
      }}
    >
      {ok ? 'Copied' : 'Copy'}
    </button>
  );
}
