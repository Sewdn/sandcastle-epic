import {
  clusterSchema,
  epicPlanSchema,
  legacyClusterSchema,
  type IssueCluster,
  type PlannedIssue,
} from "../types.js";

export function clusterLabel(cluster: IssueCluster): string {
  return cluster.issues.map((i) => `#${i.id}`).join(", ");
}

export function clusterPromptArgs(cluster: IssueCluster) {
  return {
    CLUSTER_REASON: cluster.reason,
    ISSUES_JSON: JSON.stringify(cluster.issues, null, 2),
    BRANCH_LIST: cluster.issues
      .map((i, n) => `${n + 1}. ${i.branch} (#${i.id}: ${i.title})`)
      .join("\n"),
  };
}

export function implementerRunName(cluster: IssueCluster): string {
  if (cluster.issues.length === 1) {
    return "implementer";
  }
  return `implementer-${cluster.issues.map((i) => i.id).join("-")}`;
}

export function reviewerRunName(issues: readonly PlannedIssue[]): string {
  if (issues.length === 1) {
    return "reviewer";
  }
  return `reviewer-${issues.map((i) => i.id).join("-")}`;
}

export function clustersFromIssues(issues: readonly PlannedIssue[]): IssueCluster[] {
  return issues.map((issue) => ({
    reason: "Single issue (cluster planner skipped or fallback)",
    issues: [issue],
  }));
}

function unwrapJsonFences(raw: string): string {
  const trimmed = raw.trim();
  const fence = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n\s*```\s*$/);
  return (fence ? fence[1] : trimmed).trim();
}

export function parseClusterOutput(raw: string): IssueCluster[] | null {
  let json: unknown;
  try {
    json = JSON.parse(unwrapJsonFences(raw));
  } catch {
    return null;
  }

  const epicPlan = epicPlanSchema.safeParse(json);
  if (epicPlan.success) {
    return epicPlan.data.clusters;
  }

  const current = clusterSchema.safeParse(json);
  if (current.success) {
    return current.data.clusters;
  }

  const legacy = legacyClusterSchema.safeParse(json);
  if (legacy.success) {
    return legacy.data.sessions.map(({ reason, issues }) => ({ reason, issues }));
  }

  return null;
}

export function logClusterValidationIssues(cause: unknown): void {
  if (Array.isArray(cause)) {
    for (const issue of cause) {
      console.warn(`  - ${JSON.stringify(issue)}`);
    }
    return;
  }
  if (cause !== undefined) {
    console.warn(`  ${JSON.stringify(cause)}`);
  }
}

export function validateClusters(
  planned: readonly PlannedIssue[],
  clusters: readonly IssueCluster[],
): IssueCluster[] | null {
  const plannedIds = new Set(planned.map((i) => i.id));
  const seen = new Set<string>();

  for (const cluster of clusters) {
    if (cluster.issues.length === 0) {
      return null;
    }
    for (const issue of cluster.issues) {
      if (!plannedIds.has(issue.id) || seen.has(issue.id)) {
        return null;
      }
      const canonical = planned.find((p) => p.id === issue.id);
      if (!canonical || canonical.branch !== issue.branch) {
        return null;
      }
      seen.add(issue.id);
    }
  }

  if (seen.size !== planned.length) {
    return null;
  }

  return [...clusters];
}
