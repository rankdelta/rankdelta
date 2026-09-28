/**
 * keywordClusters — FREE, client-side keyword grouping. Works on keyword ideas already fetched
 * (KeywordIdea has volume/difficulty/intent), so it adds a Semrush-style "by topic" view and a
 * questions view WITHOUT any extra DataForSEO calls. Pure functions — no network, no cost.
 *
 * Clustering is lexical: keywords are grouped by their most frequent shared significant term
 * (excluding the seed's own words and stopwords). It's an approximation of SERP-based clustering,
 * but free — true SERP clustering would need one SERP call per keyword.
 */

import type { KeywordIdea } from '../services/siteExplorer';

// Small IT+EN stopword set — enough to keep clusters meaningful without a big NLP dependency.
const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'for', 'to', 'of', 'in', 'on', 'with', 'your', 'you', 'best',
  'is', 'are', 'vs', 'per', 'con', 'del', 'della', 'delle', 'dei', 'come', 'che', 'una', 'uno',
  'gli', 'gli', 'dal', 'dalla', 'gli', 'più', 'non', 'sul', 'sulla', 'nel', 'nella', 'alla',
]);

const tokens = (kw: string): string[] =>
  kw.toLowerCase().split(/[^a-z0-9à-ÿ]+/i).filter((t) => t.length > 2 && !STOP.has(t));

export interface KeywordCluster { topic: string; keywords: KeywordIdea[]; volume: number }

/** Group keyword ideas by their strongest shared term. Singletons fall into an "Other" bucket. */
export function clusterKeywordIdeas(ideas: KeywordIdea[], seed: string): KeywordCluster[] {
  const seedTokens = new Set(tokens(seed));

  // How many keywords each (non-seed) token appears in.
  const freq = new Map<string, number>();
  for (const idea of ideas) {
    for (const t of new Set(tokens(idea.keyword))) {
      if (seedTokens.has(t)) continue;
      freq.set(t, (freq.get(t) ?? 0) + 1);
    }
  }

  const buckets = new Map<string, KeywordIdea[]>();
  const other: KeywordIdea[] = [];
  for (const idea of ideas) {
    let key: string | null = null;
    let bestFreq = 1; // require the shared term to appear in >= 2 keywords
    for (const t of tokens(idea.keyword)) {
      if (seedTokens.has(t)) continue;
      const f = freq.get(t) ?? 0;
      if (f > bestFreq) { bestFreq = f; key = t; }
    }
    if (key) {
      const arr = buckets.get(key) ?? [];
      arr.push(idea);
      buckets.set(key, arr);
    } else {
      other.push(idea);
    }
  }

  const clusters: KeywordCluster[] = [...buckets.entries()].map(([topic, kws]) => ({
    topic,
    keywords: [...kws].sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0)),
    volume: kws.reduce((s, k) => s + (k.volume ?? 0), 0),
  }));
  if (other.length) {
    clusters.push({ topic: 'Other', keywords: other, volume: other.reduce((s, k) => s + (k.volume ?? 0), 0) });
  }
  // Biggest topics first; "Other" always last.
  return clusters.sort((a, b) =>
    (a.topic === 'Other' ? 1 : 0) - (b.topic === 'Other' ? 1 : 0) || b.volume - a.volume);
}

// Question detection (EN + IT) — for the "Questions" view. Free: runs on already-fetched keywords.
const QUESTION_RE = /^(how|what|why|when|where|who|which|can|could|do|does|did|is|are|will|should|come|cosa|perch[eé]|quando|dove|chi|quale|quali|quanto|quanta|quanti)\b/i;
export const isQuestion = (kw: string): boolean => QUESTION_RE.test(kw.trim()) || kw.includes('?');
