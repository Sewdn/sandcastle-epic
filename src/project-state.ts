import { buildGlobalOpenIssueAnalysis } from "./planning.js";
import {
  loadOpenReadyForAgentIssues,
  resolveIssueCacheOptions,
  type IssueCacheOptions,
} from "./issue-cache.js";
import { enrichProjectMapWithDependencies } from "./epic-work-order.js";
import type { OpenIssueHostAnalysis } from "./dependency-chain-report.js";
import { buildProjectMap, type ProjectMap } from "./project-map.js";

export type LoadEnrichedProjectMapOptions = IssueCacheOptions;

/** GitHub project map + host dependency chain + dependency-derived epic work order. */
export async function loadEnrichedProjectMapFromGithub(
  repoRoot: string,
  canonicalSequence: readonly string[],
  scopedEpics: readonly string[],
  cacheOptions: LoadEnrichedProjectMapOptions = {},
): Promise<{ readonly projectMap: ProjectMap; readonly analysis: OpenIssueHostAnalysis }> {
  const loaded = await loadOpenReadyForAgentIssues(repoRoot, cacheOptions);
  const projectMap = buildProjectMap(canonicalSequence, scopedEpics, loaded.issues);
  const analysis = await buildGlobalOpenIssueAnalysis(
    repoRoot,
    projectMap,
    cacheOptions,
    loaded,
  );
  return {
    projectMap: enrichProjectMapWithDependencies(projectMap, analysis, scopedEpics),
    analysis,
  };
}

export { resolveIssueCacheOptions };
