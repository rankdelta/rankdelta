/**
 * Category seeds for visibility query generation.
 *
 * Without explicit product/category signals the LLM only sees the brand NAME and may infer the
 * wrong topic — e.g. a brand selling pour-over coffee kits can get prompts about espresso
 * machines. primary_keyword and main_topic are the strongest category anchors on a project; always
 * merge them with seed_keywords instead of relying on the optional seed list alone.
 *
 * Pure module (no Deno APIs) so vitest can import it unchanged from src/lib/.
 */

export type ProjectCategorySignals = {
  seed_keywords?: unknown;
  primary_keyword?: string | null;
  main_topic?: string | null;
};

export function buildCategorySeeds(project: ProjectCategorySignals): string[] {
  const seedList = Array.isArray(project.seed_keywords)
    ? (project.seed_keywords as string[])
    : [];
  return [
    ...new Set(
      [...seedList, project.primary_keyword, project.main_topic]
        .map((s) => (typeof s === 'string' ? s.trim() : ''))
        .filter(Boolean),
    ),
  ];
}
