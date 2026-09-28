import type { ResearchMarket } from '../../lib/seoMarkets';

const GROUP_LABEL: Record<ResearchMarket['group'], string> = {
  europe: 'Europe',
  americas: 'Americas',
  apac: 'Asia-Pacific',
  mea: 'Middle East & Africa',
  cities: 'Cities',
};

/**
 * Country picker. Extra countries do not change per-search DataForSEO cost —
 * the selected market is still one location_code. Native <select> keeps the
 * existing header layout and supports type-ahead.
 */
export function MarketSelect({
  markets,
  value,
  onChange,
  title,
  className = '',
}: {
  markets: ResearchMarket[];
  value: string;
  onChange: (code: string) => void;
  title?: string;
  className?: string;
}) {
  const groups: ResearchMarket['group'][] = ['europe', 'americas', 'apac', 'mea', 'cities'];
  return (
    <select
      aria-label={title ?? 'Market'}
      title={title}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`bg-white/[0.04] border border-white/[0.12] rounded-xl px-3 py-3 text-white/80 outline-none focus:border-violet-400/60 ${className}`}
    >
      {groups.map((g) => {
        const items = markets.filter((m) => m.group === g);
        if (!items.length) return null;
        return (
          <optgroup key={g} label={GROUP_LABEL[g]} className="bg-[#0b0b0f]">
            {items.map((m) => (
              <option key={m.code} value={m.code} className="bg-[#0b0b0f]">
                {m.name}
              </option>
            ))}
          </optgroup>
        );
      })}
    </select>
  );
}
