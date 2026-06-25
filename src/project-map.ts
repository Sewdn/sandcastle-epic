import { $ } from "bun";
import {
  fetchBlockedByForIssues,
  resolveGithubRepoSlug,
} from "./github-issue-dependencies.js";
import { printProjectMapReport } from "./project-map-report.js";
import { epicLabelForEpic, integrationBranchForEpic } from "./epics.js";
import {
  loadOpenReadyForAgentIssues,
  type IssueCacheOptions,
} from "./issue-cache.js";

export type EpicProjectStatus = "complete" | "has_work";

export type EpicProjectEntry = {
  readonly epic: string;
  readonly epicLabel: string;
  readonly integrationBranch: string;
  readonly status: EpicProjectStatus;
  readonly openReadyForAgent: readonly { readonly id: string; readonly title: string }[];
  readonly openReadyCount: number;
};

/** GitHub-derived view of epic progress across the backlog sequence. */
export type ProjectMap = {
  readonly fetchedAt: string;
  readonly source: "github";
  readonly canonicalSequence: readonly string[];
  readonly scopedEpics: readonly string[];
  readonly epics: readonly EpicProjectEntry[];
  /** Epics with no open `ready-for-agent` issues on GitHub. */
  readonly completedEpics: readonly string[];
  readonly scopedEpicsToRun: readonly string[];
  readonly scopedEpicsSkipped: readonly string[];
  /** Epic visit order from cross-epic dependency chain (defaults to scopedEpicsToRun until enriched). */
  readonly dependencyWorkOrder: readonly string[];
  /**
   * Next epics in canonical sequence that become actionable when {@link suggestedActiveEpic}
   * completes (depend on the active epic; other epic blockers already satisfied).
   */
  readonly forecastEpicsAfterActive: readonly string[];
  /** First epic in canonical GitHub order with open ready-for-agent work. */
  readonly githubSuggestedEpic: string | null;
  /** Epic to work on first — dependency-derived when enriched, else GitHub-first. */
  readonly suggestedActiveEpic: string | null;
};

type GithubLabel = { readonly name: string };

type GithubOpenIssue = {
  readonly number: number;
  readonly title: string;
  readonly labels: readonly GithubLabel[];
};

export type OpenReadyIssue = {
  readonly id: string;
  readonly title: string;
  readonly epicSlug: string | null;
  /** GitHub issue numbers blocking this issue (structured blocked-by relationships). */
  readonly blockedByGithubIds: readonly string[];
};

export function epicSlugFromIssueLabels(labels: readonly GithubLabel[]): string | null {
  for (const label of labels) {
    if (label.name.startsWith("epic:")) {
      return label.name.slice("epic:".length);
    }
  }
  return null;
}

export function openReadyIssuesFromGithubPayload(
  issues: readonly GithubOpenIssue[],
): readonly OpenReadyIssue[] {
  return issues.map((issue) => ({
    id: String(issue.number),
    title: issue.title,
    epicSlug: epicSlugFromIssueLabels(issue.labels),
    blockedByGithubIds: [],
  }));
}

export function buildProjectMap(
  canonicalSequence: readonly string[],
  scopedEpics: readonly string[],
  openIssues: readonly OpenReadyIssue[],
): ProjectMap {
  const issuesByEpic = new Map<string, Array<{ id: string; title: string }>>();

  for (const issue of openIssues) {
    if (!issue.epicSlug) {
      continue;
    }
    const bucket = issuesByEpic.get(issue.epicSlug) ?? [];
    bucket.push({ id: issue.id, title: issue.title });
    issuesByEpic.set(issue.epicSlug, bucket);
  }

  const epics: EpicProjectEntry[] = canonicalSequence.map((epic) => {
    const openReady = issuesByEpic.get(epic) ?? [];
    return {
      epic,
      epicLabel: epicLabelForEpic(epic),
      integrationBranch: integrationBranchForEpic(epic),
      status: openReady.length === 0 ? "complete" : "has_work",
      openReadyForAgent: openReady,
      openReadyCount: openReady.length,
    };
  });

  const completedEpics = epics.filter((entry) => entry.status === "complete").map((entry) => entry.epic);
  const completedSet = new Set(completedEpics);
  const scopedEpicsToRun = scopedEpics.filter((epic) => !completedSet.has(epic));
  const scopedEpicsSkipped = scopedEpics.filter((epic) => completedSet.has(epic));
  const githubSuggestedEpic =
    epics.find((entry) => entry.status === "has_work")?.epic ?? null;

  return {
    fetchedAt: new Date().toISOString(),
    source: "github",
    canonicalSequence,
    scopedEpics,
    epics,
    completedEpics,
    scopedEpicsToRun,
    scopedEpicsSkipped,
    dependencyWorkOrder: scopedEpicsToRun,
    forecastEpicsAfterActive: [],
    githubSuggestedEpic,
    suggestedActiveEpic: githubSuggestedEpic,
  };
}

export function filterEpicsFromProjectMap(
  scopedEpics: readonly string[],
  projectMap: ProjectMap,
): { readonly toRun: readonly string[]; readonly skipped: readonly string[] } {
  const completed = new Set(projectMap.completedEpics);
  return {
    skipped: scopedEpics.filter((epic) => completed.has(epic)),
    toRun: scopedEpics.filter((epic) => !completed.has(epic)),
  };
}

export async function fetchOpenReadyForAgentIssues(
  repo?: string,
): Promise<readonly OpenReadyIssue[]> {
  const result =
    await $`gh issue list --state open --label ready-for-agent --limit 500 --json number,title,labels`
      .quiet()
      .nothrow();

  if (result.exitCode !== 0) {
    const detail = result.stderr.toString().trim();
    throw new Error(
      `Failed to list open ready-for-agent issues from GitHub${detail ? `: ${detail}` : ""}`,
    );
  }

  const parsed = JSON.parse(result.stdout.toString()) as GithubOpenIssue[];
  const base = openReadyIssuesFromGithubPayload(parsed);
  if (base.length === 0) {
    return base;
  }

  const repoSlug = repo ?? (await resolveGithubRepoSlug());
  const blockedByByIssue = await fetchBlockedByForIssues(
    repoSlug,
    base.map((issue) => Number(issue.id)),
  );

  return base.map((issue) => ({
    ...issue,
    blockedByGithubIds: blockedByByIssue.get(issue.id) ?? [],
  }));
}

export async function loadProjectMapFromGithub(
  canonicalSequence: readonly string[],
  scopedEpics: readonly string[],
  cacheOptions: IssueCacheOptions = {},
  repoRoot?: string,
): Promise<ProjectMap> {
  if (repoRoot && cacheOptions.sandcastleDir) {
    const loaded = await loadOpenReadyForAgentIssues(repoRoot, cacheOptions);
    return buildProjectMap(canonicalSequence, scopedEpics, loaded.issues);
  }

  const openIssues = await fetchOpenReadyForAgentIssues();
  return buildProjectMap(canonicalSequence, scopedEpics, openIssues);
}

export function logProjectMapSummary(projectMap: ProjectMap): void {
  printProjectMapReport(projectMap, { scopedEpics: projectMap.scopedEpics });
}
