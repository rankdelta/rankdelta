import type { SerpFeature } from '../../lib/labsMetrics';

const LABEL: Record<SerpFeature, string> = {
  snippet: 'FS',
  video: 'Video',
  image: 'Image',
  news: 'News',
  shopping: 'Shop',
  paa: 'PAA',
  local: 'Local',
  ai: 'AI',
  kg: 'KG',
};

/** Compact SERP-feature chips like Semrush/Ahrefs keyword tables. */
export function SerpFeaturePills({ features }: { features?: SerpFeature[] | null }) {
  if (!features?.length) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {features.map((f) => (
        <span
          key={f}
          title={f}
          className="text-[10px] px-1 py-0 rounded bg-white/[0.06] text-white/45"
        >
          {LABEL[f]}
        </span>
      ))}
    </span>
  );
}
