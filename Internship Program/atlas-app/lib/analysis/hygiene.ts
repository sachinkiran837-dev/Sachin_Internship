import hygieneConfig from "@/config/hygiene-titles.json";
import type { HygieneMetrics, IngestIssue, LayoutNode } from "@/lib/graph/types";

interface HygieneTitles {
  coordinatorTitles: string[];
  supportTitles: string[];
}

const TITLES: HygieneTitles = hygieneConfig;

function matchesAny(title: string, keywords: string[]): boolean {
  const t = title.toLowerCase();
  return keywords.some((kw) => t.includes(kw.toLowerCase()));
}

/**
 * B5: structural noise that erodes accountability before it contaminates
 * other metrics. None of these are findings on their own — they're context
 * that qualifies the structural findings elsewhere (a high coordinator count
 * alongside a "thin spans" finding usually means the same layer twice, once
 * under each title).
 */
export function computeHygiene(nodes: LayoutNode[], issues: Pick<IngestIssue, "kind">[]): HygieneMetrics {
  const real = nodes.filter((n) => !n.synthetic);

  const coordinatorCount = real.filter((n) => matchesAny(n.title, TITLES.coordinatorTitles)).length;
  const supportCount = real.filter((n) => matchesAny(n.title, TITLES.supportTitles)).length;
  const orphanCount = issues.filter((i) => i.kind === "orphan").length;

  return {
    orphanCount,
    coordinatorCount,
    supportRatio: real.length === 0 ? 0 : supportCount / real.length,
  };
}
