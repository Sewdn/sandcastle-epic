import { $ } from "bun";
import type { EpicContext } from "./context.js";
import {
  githubIdForLocalId,
  issueByLocalId,
  loadCanonicalEpicSequence,
  loadMergedIssueBacklog,
  type BacklogIssue,
  type EpicMeta,
} from "./backlog.js";
import {
  countCommitsAhead,
  countCommitsAheadOf,
  featureBranchForIssue,
  integrationMentionsIssueOnBranch,
} from "./git.js";
import { integrationBranchForEpic } from "./epics.js";
import type { ProjectMap } from "./project-map.js";
import {
  analyzeOpenIssueDependencies,
  type DependencyChainEntry,
  type OpenIssueHostAnalysis,
} from "./dependency-chain-report.js";
import {
  dependencyCacheEntryForIssue,
  isIssueDependencyCacheValid,
  issueCacheOptionsFromEnv,
  loadOpenReadyForAgentIssues,
  openIssueSetsMatch,
  type IssueCacheOptions,
  writeIssueDependencyCacheMap,
} from "./issue-cache.js";
import type { IssueCluster, PlannedIssue } from "./types.js";

/** Epic-scoped pending merges that respect issue blockers (dependency order). */
export function pendingMergeIssuesFromBrief(brief: EpicBrief): PlannedIssue[] {
  return brief.openIssues
    .filter(
      (issue) =>
        issue.epic === brief.epic &&
        issue.status === "pending_merge" &&
        issue.openBlockerIds.length === 0,
    )
    .map((issue) => ({ id: issue.id, title: issue.title, branch: issue.branch }))
    .sort((left, right) => Number(left.id) - Number(right.id));
}

export async function listEpicPendingMergeIssues(ctx: EpicContext): Promise<PlannedIssue[]> {
  return pendingMergeIssuesFromBrief(await buildEpicBrief(ctx));
}

export type BriefIssueStatus = "open" | "integrated" | "pending_merge";

export type BriefIssue = {
  readonly id: string;
  readonly localId: string;
  readonly epic: string;
  readonly title: string;
  readonly branch: string;
  readonly parallel: boolean;
  readonly blockedByLocalIds: readonly string[];
  readonly blockedByEpicsOnMain: readonly string[];
  readonly openBlockerIds: readonly string[];
  readonly status: BriefIssueStatus;
  readonly references: readonly string[];
};

export type EpicBrief = {
  readonly epic: string;
  readonly epicLabel: string;
  readonly integrationBranch: string;
  readonly integrationTip: string | null;
  readonly epicMeta: EpicMeta | null;
  readonly pendingMerge: readonly {
    readonly id: string;
    readonly branch: string;
    readonly commitsAhead: number;
    readonly title: string;
  }[];
  readonly integratedIssueIds: readonly string[];
  /** All open ready-for-agent issues across epics (GitHub + backlog). */
  readonly openIssues: readonly BriefIssue[];
  /**
   * Next epics in canonical order that unblock when this epic completes (for planner context).
   */
  readonly forecastEpicsAfterActive: readonly string[];
  readonly hostAnalysis: {
    readonly unblockedIssues: readonly PlannedIssue[];
    readonly unblockedForCurrentEpic: readonly PlannedIssue[];
    readonly blockedIssues: readonly {
      readonly id: string;
      readonly epic: string;
      readonly openBlockerIds: readonly string[];
    }[];
    readonly waitingOnMerge: readonly string[];
    readonly suggestedClusters: readonly IssueCluster[];
    readonly dependencyChain: readonly DependencyChainEntry[];
    readonly readyNow: readonly DependencyChainEntry[];
    readonly blocked: readonly DependencyChainEntry[];
    readonly pendingMergeInChain: readonly DependencyChainEntry[];
  };
};

const MAX_BRANCH_SLUG_LENGTH = 30;

/** Deterministic `feature/{id}-{slug}`; reuses an existing local branch when present. */
export function branchNameForIssue(
  id: string,
  title: string,
  existingBranch?: string | null,
): string {
  if (existingBranch) {
    return existingBranch;
  }

  const withoutPrefix = title.replace(/^\[[^\]]+\]\s*/, "");
  const slug = withoutPrefix
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_BRANCH_SLUG_LENGTH);

  return `feature/${id}-${slug}`;
}

export function isEpicDependencySatisfied(
  blockerEpic: string,
  currentEpic: string,
  completedEpics: ReadonlySet<string>,
): boolean {
  return completedEpics.has(blockerEpic);
}

type IssueIntegrationState = {
  readonly integratedGithubIds: ReadonlySet<string>;
  readonly pendingMergeGithubIds: ReadonlySet<string>;
};

async function isLocalBlockerOpen(
  blockerLocalId: string,
  lookup: ReadonlyMap<string, BacklogIssue>,
  openGithubIds: ReadonlySet<string>,
  integrationState: IssueIntegrationState,
): Promise<{ readonly open: boolean; readonly blockerId: string | null }> {
  const blockerIssue = lookup.get(blockerLocalId);
  const githubId = githubIdForLocalId(blockerLocalId, lookup);
  const blockerId = githubId ?? blockerLocalId;

  if (!githubId) {
    return { open: false, blockerId: null };
  }

  if (integrationState.integratedGithubIds.has(githubId)) {
    return { open: false, blockerId: null };
  }

  if (integrationState.pendingMergeGithubIds.has(githubId)) {
    return { open: true, blockerId };
  }

  if (openGithubIds.has(githubId)) {
    return { open: true, blockerId };
  }

  const epic = blockerIssue?.epic;
  if (!epic) {
    return { open: false, blockerId: null };
  }

  if (await integrationMentionsIssueOnBranch(integrationBranchForEpic(epic), githubId)) {
    return { open: false, blockerId: null };
  }

  return { open: true, blockerId };
}

async function resolveOpenBlockerIds(
  issue: BacklogIssue,
  lookup: ReadonlyMap<string, BacklogIssue>,
  openGithubIds: ReadonlySet<string>,
  integrationState: IssueIntegrationState,
  completedEpics: ReadonlySet<string>,
): Promise<string[]> {
  const blockers: string[] = [];

  for (const localId of issue.blocked_by_issues ?? []) {
    const result = await isLocalBlockerOpen(
      localId,
      lookup,
      openGithubIds,
      integrationState,
    );
    if (result.open && result.blockerId) {
      blockers.push(result.blockerId);
    }
  }

  for (const epic of issue.blocked_by_epics_on_main ?? []) {
    if (!isEpicDependencySatisfied(epic, issue.epic, completedEpics)) {
      blockers.push(`epic:${epic}`);
    }
  }

  return blockers;
}

function suggestClusters(
  unblocked: readonly PlannedIssue[],
  briefIssues: readonly BriefIssue[],
): IssueCluster[] {
  if (unblocked.length === 0) {
    return [];
  }

  const byId = new Map(briefIssues.map((issue) => [issue.id, issue]));

  return unblocked.map((issue) => {
    const brief = byId.get(issue.id);
    const parallelHint = brief?.parallel ? "marked parallel in backlog" : "sequential track";
    return {
      reason: `Host default: one implementer run per issue (${parallelHint}; agent may cluster overlaps).`,
      issues: [issue],
    };
  });
}

function buildIssueIntegrationState(
  candidates: readonly {
    readonly id: string;
    readonly commitsAhead: number;
    readonly integrated: boolean;
  }[],
): IssueIntegrationState {
  const integratedGithubIds = new Set<string>();
  const pendingMergeGithubIds = new Set<string>();

  for (const candidate of candidates) {
    if (candidate.integrated) {
      integratedGithubIds.add(candidate.id);
    } else if (candidate.commitsAhead > 0) {
      pendingMergeGithubIds.add(candidate.id);
    }
  }

  return { integratedGithubIds, pendingMergeGithubIds };
}

async function integrationTipSha(integrationBranch: string): Promise<string | null> {
  const result = await $`git rev-parse ${integrationBranch}`.quiet().nothrow();
  if (result.exitCode !== 0) {
    return null;
  }
  return result.stdout.toString().trim() || null;
}

/** Cross-epic open issues with YAML blockers + git integration state (no active epic required). */
export async function buildOpenIssuesFromBacklog(
  repoRoot: string,
  projectMap: ProjectMap | null,
  cacheOptions: IssueCacheOptions = {},
  preloadedOpenReady?: Awaited<ReturnType<typeof loadOpenReadyForAgentIssues>>,
): Promise<readonly BriefIssue[]> {
  const backlog = loadMergedIssueBacklog(repoRoot);
  const lookup = issueByLocalId(backlog);
  const loaded = preloadedOpenReady ?? (await loadOpenReadyForAgentIssues(repoRoot, cacheOptions));
  const openReady = loaded.issues;
  const openGithubIds = new Set(openReady.map((issue) => issue.id));
  const completedEpics = new Set(projectMap?.completedEpics ?? []);
  const useDependencyCache =
    loaded.fromCache &&
    loaded.cache !== null &&
    isIssueDependencyCacheValid(loaded.cache, loaded.backlogFingerprint, cacheOptions) &&
    openIssueSetsMatch(loaded.cache.openReadyForAgent, openReady);

  if (useDependencyCache) {
    console.log(
      `  Using cached issue dependencies (${loaded.cache!.issueDependencies ? Object.keys(loaded.cache!.issueDependencies).length : 0} issue(s))…`,
    );
  }

  const candidates: Array<{
    yamlIssue: BacklogIssue;
    id: string;
    branch: string;
    commitsAhead: number;
    integrated: boolean;
  }> = [];

  for (const yamlIssue of backlog.issues) {
    if (yamlIssue.github === null || !openGithubIds.has(String(yamlIssue.github))) {
      continue;
    }

    const id = String(yamlIssue.github);
    const issueIntegrationBranch = integrationBranchForEpic(yamlIssue.epic);
    const existingBranch = await featureBranchForIssue(id);
    const branch = branchNameForIssue(id, yamlIssue.title, existingBranch);
    const commitsAhead = existingBranch
      ? await countCommitsAheadOf(issueIntegrationBranch, existingBranch)
      : 0;
    const integrated =
      commitsAhead === 0 &&
      (await integrationMentionsIssueOnBranch(issueIntegrationBranch, id));

    candidates.push({ yamlIssue, id, branch, commitsAhead, integrated });
  }

  const integrationState = buildIssueIntegrationState(candidates);
  const openIssues: BriefIssue[] = [];
  const dependencyEntries: Record<string, ReturnType<typeof dependencyCacheEntryForIssue>> = {};

  for (const candidate of candidates) {
    if (candidate.integrated) {
      continue;
    }

    const { yamlIssue, id, branch, commitsAhead } = candidate;
    const cachedEntry = useDependencyCache ? loaded.cache?.issueDependencies[id] : undefined;

    const openBlockerIds =
      cachedEntry?.openBlockerIds ??
      (await resolveOpenBlockerIds(
        yamlIssue,
        lookup,
        openGithubIds,
        integrationState,
        completedEpics,
      ));

    const briefIssue: BriefIssue = {
      id,
      localId: yamlIssue.local_id,
      epic: yamlIssue.epic,
      title: yamlIssue.title,
      branch,
      parallel: yamlIssue.parallel ?? false,
      blockedByLocalIds: yamlIssue.blocked_by_issues ?? [],
      blockedByEpicsOnMain: yamlIssue.blocked_by_epics_on_main ?? [],
      openBlockerIds: [...openBlockerIds],
      status: commitsAhead > 0 ? "pending_merge" : "open",
      references: yamlIssue.references ?? [],
    };

    openIssues.push(briefIssue);
    dependencyEntries[id] = dependencyCacheEntryForIssue(briefIssue);
  }

  if (cacheOptions.sandcastleDir) {
    writeIssueDependencyCacheMap(
      cacheOptions.sandcastleDir,
      loaded.backlogFingerprint,
      openReady,
      dependencyEntries,
    );
  }

  return openIssues;
}

/** Deterministic cross-epic dependency analysis for all open ready-for-agent issues. */
export async function buildGlobalOpenIssueAnalysis(
  repoRoot: string,
  projectMap: ProjectMap,
  cacheOptions: IssueCacheOptions = {},
  preloadedOpenReady?: Awaited<ReturnType<typeof loadOpenReadyForAgentIssues>>,
): Promise<OpenIssueHostAnalysis> {
  const openIssues = await buildOpenIssuesFromBacklog(
    repoRoot,
    projectMap,
    cacheOptions,
    preloadedOpenReady,
  );
  return analyzeOpenIssueDependencies(openIssues, projectMap.canonicalSequence);
}

export async function buildEpicBrief(ctx: EpicContext): Promise<EpicBrief> {
  const { epic, integrationBranch, epicLabel, repoRoot } = ctx.config;
  const backlog = loadMergedIssueBacklog(repoRoot);
  const epicMeta = backlog.epics[epic] ?? null;
  const openIssues = await buildOpenIssuesFromBacklog(
    repoRoot,
    ctx.projectMap,
    issueCacheOptionsFromEnv(ctx.config.sandcastleDir),
  );
  const canonicalSequence =
    ctx.projectMap?.canonicalSequence ?? loadCanonicalEpicSequence(repoRoot);
  const dependency = analyzeOpenIssueDependencies(openIssues, canonicalSequence);

  const integratedIssueIdsResolved: string[] = [];
  const pendingMerge: Array<{
    id: string;
    branch: string;
    commitsAhead: number;
    title: string;
  }> = [];

  for (const issue of openIssues) {
    if (issue.epic !== epic) {
      continue;
    }
    if (issue.status === "pending_merge") {
      const commitsAhead = await countCommitsAhead(ctx, issue.branch);
      pendingMerge.push({
        id: issue.id,
        branch: issue.branch,
        commitsAhead,
        title: issue.title,
      });
    }
  }

  // Issues integrated on current epic branch but still open on GitHub are reconciled separately
  for (const yamlIssue of backlog.issues) {
    if (yamlIssue.epic !== epic || yamlIssue.github === null) {
      continue;
    }
    const id = String(yamlIssue.github);
    if (openIssues.some((issue) => issue.id === id)) {
      continue;
    }
    const issueIntegrationBranch = integrationBranchForEpic(epic);
    if (await integrationMentionsIssueOnBranch(issueIntegrationBranch, id)) {
      integratedIssueIdsResolved.push(id);
    }
  }

  const waitingOnMerge = openIssues
    .filter((issue) => issue.status === "pending_merge")
    .map((issue) => issue.id);

  const blockedIssues = openIssues
    .filter((issue) => issue.status === "open" && issue.openBlockerIds.length > 0)
    .map((issue) => ({
      id: issue.id,
      epic: issue.epic,
      openBlockerIds: issue.openBlockerIds,
    }));

  const unblockedIssues: PlannedIssue[] = dependency.readyNow.map((entry) => {
    const issue = openIssues.find((item) => item.id === entry.id)!;
    return { id: issue.id, title: issue.title, branch: issue.branch };
  });

  const unblockedForCurrentEpic = unblockedIssues.filter((issue) => {
    const briefIssue = openIssues.find((entry) => entry.id === issue.id);
    return briefIssue?.epic === epic;
  });

  const suggestedClusters = suggestClusters(unblockedForCurrentEpic, openIssues);

  const forecastEpicsAfterActive = ctx.projectMap?.forecastEpicsAfterActive ?? [];

  return {
    epic,
    epicLabel,
    integrationBranch,
    integrationTip: await integrationTipSha(integrationBranch),
    epicMeta,
    pendingMerge,
    integratedIssueIds: integratedIssueIdsResolved,
    openIssues,
    forecastEpicsAfterActive,
    hostAnalysis: {
      unblockedIssues,
      unblockedForCurrentEpic,
      blockedIssues,
      waitingOnMerge,
      suggestedClusters,
      dependencyChain: dependency.dependencyChain,
      readyNow: dependency.readyNow,
      blocked: dependency.blocked,
      pendingMergeInChain: dependency.pendingMerge,
    },
  };
}

export function flattenClusters(clusters: readonly IssueCluster[]): PlannedIssue[] {
  return clusters.flatMap((cluster) => cluster.issues);
}

export function filterClustersToIssues(
  clusters: readonly IssueCluster[],
  allowed: readonly PlannedIssue[],
): IssueCluster[] {
  const allowedIds = new Set(allowed.map((issue) => issue.id));
  const kept: IssueCluster[] = [];

  for (const cluster of clusters) {
    const issues = cluster.issues.filter((issue) => allowedIds.has(issue.id));
    if (issues.length > 0) {
      kept.push({ ...cluster, issues });
    }
  }

  return kept;
}

export function filterClustersToEpic(
  clusters: readonly IssueCluster[],
  epic: string,
  brief: EpicBrief,
): IssueCluster[] {
  const allowedIds = new Set(
    brief.openIssues.filter((issue) => issue.epic === epic).map((issue) => issue.id),
  );
  const kept: IssueCluster[] = [];

  for (const cluster of clusters) {
    const issues = cluster.issues.filter((issue) => allowedIds.has(issue.id));
    if (issues.length > 0) {
      kept.push({ ...cluster, issues });
    }
  }

  return kept;
}
