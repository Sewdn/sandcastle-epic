import type { OpenIssueHostAnalysis } from "./dependency-chain-report.js";
import type { BriefIssue } from "./planning.js";
import type { ProjectMap } from "./project-map.js";

export type EpicWorkOrderEntry = {
  readonly epic: string;
  readonly openCount: number;
  readonly readyCount: number;
  readonly pendingMergeCount: number;
  readonly blockedCount: number;
  readonly dependsOnEpics: readonly string[];
};

export type EpicWorkOrder = {
  /** Epics with GitHub work, ordered for orchestrator visits (blockers and forecast chain first). */
  readonly workOrder: readonly string[];
  /** First epic in canonical order with actionable host work and satisfied epic blockers. */
  readonly suggestedActiveEpic: string | null;
  readonly entries: readonly EpicWorkOrderEntry[];
};

type EpicWorkOrderContext = {
  readonly epicsWithWork: readonly string[];
  readonly entries: readonly EpicWorkOrderEntry[];
  readonly dependsOn: ReadonlyMap<string, ReadonlySet<string>>;
};

function epicIndex(epic: string, canonicalSequence: readonly string[]): number {
  const index = canonicalSequence.indexOf(epic);
  return index >= 0 ? index : Number.MAX_SAFE_INTEGER;
}

function issueStatus(issue: BriefIssue): "ready" | "blocked" | "pending_merge" {
  if (issue.status === "pending_merge") {
    return "pending_merge";
  }
  return issue.openBlockerIds.length === 0 ? "ready" : "blocked";
}

function summarizeEpic(issues: readonly BriefIssue[]): Omit<EpicWorkOrderEntry, "epic" | "dependsOnEpics"> {
  let readyCount = 0;
  let blockedCount = 0;
  let pendingMergeCount = 0;

  for (const issue of issues) {
    const status = issueStatus(issue);
    if (status === "ready") {
      readyCount += 1;
    } else if (status === "pending_merge") {
      pendingMergeCount += 1;
    } else {
      blockedCount += 1;
    }
  }

  return {
    openCount: issues.length,
    readyCount,
    pendingMergeCount,
    blockedCount,
  };
}

function blockerEpicSlugs(
  issue: BriefIssue,
  issueEpicById: ReadonlyMap<string, string>,
  epicsWithWork: ReadonlySet<string>,
): readonly string[] {
  const deps = new Set<string>();

  for (const blocker of issue.openBlockerIds) {
    if (blocker.startsWith("epic:")) {
      const epic = blocker.slice("epic:".length);
      if (epic !== issue.epic && epicsWithWork.has(epic)) {
        deps.add(epic);
      }
      continue;
    }

    const blockerEpic = issueEpicById.get(blocker);
    if (blockerEpic && blockerEpic !== issue.epic && epicsWithWork.has(blockerEpic)) {
      deps.add(blockerEpic);
    }
  }

  return [...deps];
}

function epicBlockersForEpic(
  openIssues: readonly BriefIssue[],
  epic: string,
): readonly string[] {
  const deps = new Set<string>();
  for (const issue of openIssues) {
    if (issue.epic !== epic) {
      continue;
    }
    for (const blocker of issue.openBlockerIds) {
      if (blocker.startsWith("epic:")) {
        deps.add(blocker.slice("epic:".length));
      }
    }
  }
  return [...deps];
}

function buildEpicWorkOrderContext(
  analysis: OpenIssueHostAnalysis,
  projectMap: ProjectMap,
  scopedEpics?: readonly string[],
): EpicWorkOrderContext {
  const scoped = scopedEpics ?? projectMap.scopedEpics;
  const scopedSet = new Set(scoped);
  const epicsWithWork = projectMap.scopedEpicsToRun.filter(
    (epic) => scopedSet.size === 0 || scopedSet.has(epic),
  );
  const epicsWithWorkSet = new Set(epicsWithWork);

  const issuesByEpic = new Map<string, BriefIssue[]>();
  const issueEpicById = new Map<string, string>();

  for (const issue of analysis.openIssues) {
    if (!epicsWithWorkSet.has(issue.epic)) {
      continue;
    }
    issueEpicById.set(issue.id, issue.epic);
    const bucket = issuesByEpic.get(issue.epic) ?? [];
    bucket.push(issue);
    issuesByEpic.set(issue.epic, bucket);
  }

  const dependsOn = new Map<string, Set<string>>();
  for (const epic of epicsWithWork) {
    dependsOn.set(epic, new Set());
  }

  for (const [epic, issues] of issuesByEpic) {
    const epicDeps = dependsOn.get(epic)!;
    for (const issue of issues) {
      for (const dep of blockerEpicSlugs(issue, issueEpicById, epicsWithWorkSet)) {
        epicDeps.add(dep);
      }
    }
  }

  const entries: EpicWorkOrderEntry[] = epicsWithWork.map((epic) => ({
    epic,
    ...summarizeEpic(issuesByEpic.get(epic) ?? []),
    dependsOnEpics: [...(dependsOn.get(epic) ?? [])].sort(
      (left, right) =>
        epicIndex(left, projectMap.canonicalSequence) - epicIndex(right, projectMap.canonicalSequence),
    ),
  }));

  return { epicsWithWork, entries, dependsOn };
}


function epicVisitDependencies(
  epic: string,
  context: EpicWorkOrderContext,
  analysis: OpenIssueHostAnalysis,
  projectMap: ProjectMap,
): readonly string[] {
  const deps = new Set<string>();

  for (const dep of context.dependsOn.get(epic) ?? []) {
    deps.add(dep);
  }

  for (const dep of epicBlockersForEpic(analysis.openIssues, epic)) {
    deps.add(dep);
  }

  return [...deps].sort(
    (left, right) =>
      epicIndex(left, projectMap.canonicalSequence) - epicIndex(right, projectMap.canonicalSequence),
  );
}

/**
 * Walk canonical order: for each epic with work, visit cross-epic blockers first, then the epic.
 * Keeps branch focus (finish aa9 before aa3) while prioritizing early epics (aa2 before aa5…).
 */
function buildGoalDirectedVisitOrder(
  context: EpicWorkOrderContext,
  projectMap: ProjectMap,
  analysis: OpenIssueHostAnalysis,
): string[] {
  const completed = new Set(projectMap.completedEpics);
  const workSet = new Set(context.epicsWithWork);
  const placed = new Set<string>();
  const order: string[] = [];

  function schedule(epic: string): void {
    if (!workSet.has(epic) || completed.has(epic) || placed.has(epic)) {
      return;
    }

    for (const dep of epicVisitDependencies(epic, context, analysis, projectMap)) {
      if (workSet.has(dep) && !completed.has(dep)) {
        schedule(dep);
      }
    }

    if (!placed.has(epic)) {
      order.push(epic);
      placed.add(epic);
    }
  }

  for (const epic of projectMap.canonicalSequence) {
    schedule(epic);
  }

  for (const epic of context.epicsWithWork) {
    schedule(epic);
  }

  return order;
}

function findSuggestedActiveEpic(
  context: EpicWorkOrderContext,
  visitOrder: readonly string[],
): string | null {
  for (const epic of visitOrder) {
    const entry = context.entries.find((item) => item.epic === epic);
    if (entry && (entry.readyCount > 0 || entry.pendingMergeCount > 0)) {
      return epic;
    }
  }

  return visitOrder[0] ?? null;
}

/** Epic visit order for orchestration: blockers before dependents; forecast chain after the active epic. */
export function deriveEpicWorkOrder(
  analysis: OpenIssueHostAnalysis,
  projectMap: ProjectMap,
  scopedEpics?: readonly string[],
): EpicWorkOrder {
  const context = buildEpicWorkOrderContext(analysis, projectMap, scopedEpics);

  if (context.epicsWithWork.length === 0) {
    return { workOrder: [], suggestedActiveEpic: null, entries: [] };
  }

  const workOrder = buildGoalDirectedVisitOrder(context, projectMap, analysis);
  const suggestedActiveEpic = findSuggestedActiveEpic(context, workOrder);

  return { workOrder, suggestedActiveEpic, entries: context.entries };
}

const DEFAULT_FORECAST_EPIC_COUNT = 2;

/**
 * Epics in canonical order that unblock when `anchorEpic` completes: they depend on the
 * anchor epic and any other epic blockers are already GitHub-complete.
 */
export function deriveForecastEpicsAfterAnchor(
  analysis: OpenIssueHostAnalysis,
  projectMap: ProjectMap,
  anchorEpic: string,
  limit = DEFAULT_FORECAST_EPIC_COUNT,
  scopedEpics?: readonly string[],
): readonly string[] {
  const context = buildEpicWorkOrderContext(analysis, projectMap, scopedEpics);
  return forecastEpicsAfterAnchor(context, analysis, projectMap, anchorEpic, limit, scopedEpics);
}

function forecastEpicsAfterAnchor(
  context: EpicWorkOrderContext,
  analysis: OpenIssueHostAnalysis,
  projectMap: ProjectMap,
  anchorEpic: string,
  limit: number,
  scopedEpics?: readonly string[],
): readonly string[] {
  if (limit <= 0) {
    return [];
  }

  const completed = new Set(projectMap.completedEpics);
  const scopedSet = scopedEpics ? new Set(scopedEpics) : null;

  return context.entries
    .filter((entry) => {
      if (entry.epic === anchorEpic || entry.openCount === 0) {
        return false;
      }
      if (scopedSet && !scopedSet.has(entry.epic)) {
        return false;
      }
      const epicBlockers = epicBlockersForEpic(analysis.openIssues, entry.epic);
      if (!epicBlockers.includes(anchorEpic)) {
        return false;
      }
      return epicBlockers.every(
        (dep) => dep === anchorEpic || completed.has(dep),
      );
    })
    .map((entry) => entry.epic)
    .sort(
      (left, right) =>
        epicIndex(left, projectMap.canonicalSequence) -
        epicIndex(right, projectMap.canonicalSequence),
    )
    .slice(0, limit);
}

/** Apply dependency-derived epic order onto a GitHub project map. */
export function enrichProjectMapWithDependencies(
  projectMap: ProjectMap,
  analysis: OpenIssueHostAnalysis,
  scopedEpics?: readonly string[],
): ProjectMap {
  const context = buildEpicWorkOrderContext(analysis, projectMap, scopedEpics);
  const workOrder = buildGoalDirectedVisitOrder(context, projectMap, analysis);
  const suggestedActiveEpic = findSuggestedActiveEpic(context, workOrder);
  const forecastEpicsAfterActive = suggestedActiveEpic
    ? forecastEpicsAfterAnchor(
        context,
        analysis,
        projectMap,
        suggestedActiveEpic,
        DEFAULT_FORECAST_EPIC_COUNT,
        scopedEpics,
      )
    : [];

  return {
    ...projectMap,
    dependencyWorkOrder: workOrder,
    suggestedActiveEpic,
    forecastEpicsAfterActive,
    githubSuggestedEpic: projectMap.githubSuggestedEpic ?? projectMap.suggestedActiveEpic,
  };
}

export function epicsToRunInDependencyOrder(
  projectMap: ProjectMap,
  scopedEpics: readonly string[],
): readonly string[] {
  const scopedSet = new Set(scopedEpics);
  const completed = new Set(projectMap.completedEpics);
  const queue =
    projectMap.dependencyWorkOrder.length > 0
      ? projectMap.dependencyWorkOrder
      : projectMap.scopedEpicsToRun;

  return queue.filter((epic) => scopedSet.has(epic) && !completed.has(epic));
}
