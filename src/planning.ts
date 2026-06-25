import { $ } from "bun";
import type { EpicContext } from "./context.js";
import { countCommitsAhead, featureBranchForIssue, integrationMentionsIssue } from "./git.js";
import {
  epicIssues,
  githubIdForLocalId,
  issueByLocalId,
  loadIssueBacklog,
  type BacklogIssue,
  type EpicMeta,
} from "./backlog.js";
import { loadCompletedEpics } from "./completed-epics.js";
import type { IssueCluster, PlannedIssue } from "./types.js";

/** Epic-scoped pending merges that respect issue blockers (dependency order). */
export function pendingMergeIssuesFromBrief(brief: EpicBrief): PlannedIssue[] {
  return brief.openIssues
    .filter((issue) => issue.status === "pending_merge" && issue.openBlockerIds.length === 0)
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
  readonly openIssues: readonly BriefIssue[];
  readonly hostAnalysis: {
    readonly unblockedIssues: readonly PlannedIssue[];
    readonly blockedIssues: readonly {
      readonly id: string;
      readonly openBlockerIds: readonly string[];
    }[];
    readonly waitingOnMerge: readonly string[];
    readonly suggestedClusters: readonly IssueCluster[];
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

function isEpicDependencySatisfied(
  blockerEpic: string,
  currentEpic: string,
  completedEpics: ReadonlySet<string>,
): boolean {
  if (completedEpics.has(blockerEpic)) {
    return true;
  }

  const blockerMatch = /^([a-z])(\d+)$/.exec(blockerEpic);
  const currentMatch = /^([a-z])(\d+)$/.exec(currentEpic);
  if (!blockerMatch || !currentMatch || blockerMatch[1] !== currentMatch[1]) {
    return false;
  }

  return Number(blockerMatch[2]) < Number(currentMatch[2]);
}

async function isLocalBlockerOpen(
  ctx: EpicContext,
  blockerLocalId: string,
  lookup: ReadonlyMap<string, BacklogIssue>,
  openGithubIds: ReadonlySet<string>,
  integratedGithubIds: ReadonlySet<string>,
  pendingMergeIds: ReadonlySet<string>,
): Promise<boolean> {
  const githubId = githubIdForLocalId(blockerLocalId, lookup);
  if (!githubId) {
    return false;
  }

  if (integratedGithubIds.has(githubId)) {
    return false;
  }

  if (pendingMergeIds.has(githubId)) {
    return true;
  }

  if (openGithubIds.has(githubId)) {
    return true;
  }

  return !(await integrationMentionsIssue(ctx, githubId));
}

async function resolveOpenBlockerIds(
  ctx: EpicContext,
  issue: BacklogIssue,
  lookup: ReadonlyMap<string, BacklogIssue>,
  openGithubIds: ReadonlySet<string>,
  integratedGithubIds: ReadonlySet<string>,
  pendingMergeIds: ReadonlySet<string>,
  currentEpic: string,
  completedEpics: ReadonlySet<string>,
): Promise<string[]> {
  const blockers: string[] = [];

  for (const localId of issue.blocked_by_issues ?? []) {
    const githubId = githubIdForLocalId(localId, lookup);
    if (
      await isLocalBlockerOpen(
        ctx,
        localId,
        lookup,
        openGithubIds,
        integratedGithubIds,
        pendingMergeIds,
      )
    ) {
      if (githubId) {
        blockers.push(githubId);
      } else {
        blockers.push(localId);
      }
    }
  }

  for (const epic of issue.blocked_by_epics_on_main ?? []) {
    if (!isEpicDependencySatisfied(epic, currentEpic, completedEpics)) {
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

  const parallelGroups = new Map<string, PlannedIssue[]>();
  for (const planned of unblocked) {
    const brief = byId.get(planned.id);
    const key = brief?.parallel ? "parallel" : "sequential";
    const bucket = parallelGroups.get(key) ?? [];
    bucket.push(planned);
    parallelGroups.set(key, bucket);
  }

  return unblocked.map((issue) => {
    const brief = byId.get(issue.id);
    const parallelHint = brief?.parallel ? "marked parallel in backlog" : "sequential track";
    return {
      reason: `Host default: one implementer run per issue (${parallelHint}; agent may cluster overlaps).`,
      issues: [issue],
    };
  });
}

async function listOpenReadyGithubIssues(
  ctx: EpicContext,
): Promise<readonly { readonly id: string; readonly title: string }[]> {
  const result =
    await $`gh issue list --state open --label ready-for-agent --label ${ctx.config.epicLabel} --limit 100 --json number,title`
      .quiet()
      .nothrow();

  if (result.exitCode !== 0) {
    console.error(`  Failed to list open issues: ${result.stderr.toString().trim()}`);
    return [];
  }

  const parsed = JSON.parse(result.stdout.toString()) as Array<{ number: number; title: string }>;
  return parsed.map((issue) => ({ id: String(issue.number), title: issue.title }));
}

async function integrationTipSha(integrationBranch: string): Promise<string | null> {
  const result = await $`git rev-parse ${integrationBranch}`.quiet().nothrow();
  if (result.exitCode !== 0) {
    return null;
  }
  return result.stdout.toString().trim() || null;
}

export async function buildEpicBrief(ctx: EpicContext): Promise<EpicBrief> {
  const { epic, integrationBranch, epicLabel, repoRoot, sandcastleDir } = ctx.config;
  const backlog = loadIssueBacklog(repoRoot, epic);
  const lookup = issueByLocalId(backlog);
  const epicMeta = backlog.epics[epic] ?? null;
  const yamlEpicIssues = epicIssues(backlog, epic);
  const openReady = await listOpenReadyGithubIssues(ctx);
  const openGithubIds = new Set(openReady.map((issue) => issue.id));
  const completedEpics = new Set(loadCompletedEpics(sandcastleDir));

  const integratedIssueIds: string[] = [];
  const pendingMerge: Array<{
    id: string;
    branch: string;
    commitsAhead: number;
    title: string;
  }> = [];
  const candidates: Array<{
    yamlIssue: BacklogIssue;
    id: string;
    branch: string;
    commitsAhead: number;
    integrated: boolean;
  }> = [];

  for (const yamlIssue of yamlEpicIssues) {
    if (yamlIssue.github === null || !openGithubIds.has(String(yamlIssue.github))) {
      continue;
    }

    const id = String(yamlIssue.github);
    const existingBranch = await featureBranchForIssue(id);
    const branch = branchNameForIssue(id, yamlIssue.title, existingBranch);
    const commitsAhead = existingBranch ? await countCommitsAhead(ctx, existingBranch) : 0;
    const integrated = commitsAhead === 0 && (await integrationMentionsIssue(ctx, id));

    if (integrated) {
      integratedIssueIds.push(id);
    }

    candidates.push({ yamlIssue, id, branch, commitsAhead, integrated });
  }

  const integratedSet = new Set(integratedIssueIds);
  const openIssues: BriefIssue[] = [];

  for (const candidate of candidates) {
    if (candidate.integrated) {
      continue;
    }

    const { yamlIssue, id, branch, commitsAhead } = candidate;

    if (commitsAhead > 0) {
      pendingMerge.push({
        id,
        branch,
        commitsAhead,
        title: yamlIssue.title,
      });
    }

    const pendingIds = new Set(pendingMerge.map((entry) => entry.id));
    const openBlockerIds = await resolveOpenBlockerIds(
      ctx,
      yamlIssue,
      lookup,
      openGithubIds,
      integratedSet,
      pendingIds,
      epic,
      completedEpics,
    );

    openIssues.push({
      id,
      localId: yamlIssue.local_id,
      title: yamlIssue.title,
      branch,
      parallel: yamlIssue.parallel ?? false,
      blockedByLocalIds: yamlIssue.blocked_by_issues ?? [],
      blockedByEpicsOnMain: yamlIssue.blocked_by_epics_on_main ?? [],
      openBlockerIds,
      status: commitsAhead > 0 ? "pending_merge" : "open",
      references: yamlIssue.references ?? [],
    });
  }

  const waitingOnMerge = openIssues
    .filter((issue) => issue.status === "pending_merge")
    .map((issue) => issue.id);

  const blockedIssues = openIssues
    .filter((issue) => issue.status === "open" && issue.openBlockerIds.length > 0)
    .map((issue) => ({ id: issue.id, openBlockerIds: issue.openBlockerIds }));

  const unblockedBrief = openIssues.filter(
    (issue) => issue.status === "open" && issue.openBlockerIds.length === 0,
  );

  const unblockedIssues: PlannedIssue[] = unblockedBrief.map((issue) => ({
    id: issue.id,
    title: issue.title,
    branch: issue.branch,
  }));

  const suggestedClusters = suggestClusters(unblockedIssues, openIssues);

  return {
    epic,
    epicLabel,
    integrationBranch,
    integrationTip: await integrationTipSha(integrationBranch),
    epicMeta,
    pendingMerge,
    integratedIssueIds,
    openIssues,
    hostAnalysis: {
      unblockedIssues,
      blockedIssues,
      waitingOnMerge,
      suggestedClusters,
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
