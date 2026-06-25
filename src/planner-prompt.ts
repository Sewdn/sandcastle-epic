import path from "node:path";
import { clusterLabel } from "./cluster/helpers.js";
import { ISSUE_CACHE_DIR, ISSUE_CACHE_FILENAME, issueCacheMapPath } from "./issue-cache.js";
import type { EpicBrief } from "./planning.js";
import type { ProjectMap } from "./project-map.js";

/** Repo-relative path to the host issue dependency cache (for planner `gh`/file lookups). */
export function issueCachePathForPrompt(sandcastleDir: string, repoRoot: string): string {
  const absolute = issueCacheMapPath(sandcastleDir);
  const relative = path.relative(repoRoot, absolute);
  if (relative.length > 0 && !relative.startsWith("..")) {
    return relative;
  }
  return path.join(path.basename(sandcastleDir), ISSUE_CACHE_DIR, ISSUE_CACHE_FILENAME);
}

/** Host-computed planner input — deterministic baseline only, no full issue dump. */
export function formatHostPlannerBaselineForPrompt(
  brief: EpicBrief,
  projectMap: ProjectMap | null = null,
): string {
  const lines: string[] = [];
  const currentEpicOpen = brief.openIssues.filter((issue) => issue.epic === brief.epic);
  const readyThisEpic = brief.hostAnalysis.unblockedForCurrentEpic.length;
  const blockedThisEpic = brief.hostAnalysis.blocked.filter(
    (entry) => entry.epic === brief.epic,
  ).length;

  lines.push("## Summary");
  lines.push(`- Epic: ${brief.epicLabel}`);
  lines.push(`- Integration branch: ${brief.integrationBranch}`);
  lines.push(`- Open issues: ${brief.openIssues.length} global · ${currentEpicOpen.length} this epic`);
  lines.push(
    `- Host ready: ${brief.hostAnalysis.readyNow.length} global · ${readyThisEpic} this epic`,
  );
  lines.push(
    `- Host blocked: ${brief.hostAnalysis.blocked.length} global · ${blockedThisEpic} this epic`,
  );
  lines.push(`- Pending merge (this epic): ${brief.pendingMerge.length}`);
  if (brief.forecastEpicsAfterActive.length > 0) {
    lines.push(`- Forecast after this epic: ${brief.forecastEpicsAfterActive.join(", ")}`);
  }
  if (projectMap?.suggestedActiveEpic) {
    lines.push(`- Suggested active epic: ${projectMap.suggestedActiveEpic}`);
  }

  if (brief.integratedIssueIds.length > 0) {
    lines.push("");
    lines.push("## Integrated on this branch (exclude from plan)");
    lines.push(brief.integratedIssueIds.map((id) => `#${id}`).join(", "));
  }

  if (brief.pendingMerge.length > 0) {
    lines.push("");
    lines.push("## Pending merge (exclude from plan — merge gate first)");
    for (const entry of brief.pendingMerge) {
      lines.push(
        `- #${entry.id} · ${entry.branch} · ${entry.commitsAhead} commit(s) ahead · ${entry.title}`,
      );
    }
  }

  if (brief.hostAnalysis.unblockedForCurrentEpic.length > 0) {
    lines.push("");
    lines.push("## Ready for this epic (host)");
    lines.push("| Issue | Parallel | Branch | Title |");
    lines.push("| --- | --- | --- | --- |");
    for (const issue of brief.hostAnalysis.unblockedForCurrentEpic) {
      const parallel = brief.openIssues.find((entry) => entry.id === issue.id)?.parallel
        ? "yes"
        : "no";
      lines.push(`| #${issue.id} | ${parallel} | ${issue.branch} | ${issue.title} |`);
    }
  } else {
    lines.push("");
    lines.push("## Ready for this epic (host)");
    lines.push("None.");
  }

  if (brief.hostAnalysis.suggestedClusters.length > 0) {
    lines.push("");
    lines.push("## Host-suggested clusters (default: one issue per run)");
    for (const [index, cluster] of brief.hostAnalysis.suggestedClusters.entries()) {
      lines.push(`${index + 1}. ${clusterLabel(cluster)} — ${cluster.reason}`);
    }
  }

  const blockedThisEpicEntries = brief.hostAnalysis.blocked.filter(
    (entry) => entry.epic === brief.epic,
  );
  if (blockedThisEpicEntries.length > 0) {
    lines.push("");
    lines.push("## Blocked on this epic (host · cross-epic)");
    lines.push("| Issue | Blocked by |");
    lines.push("| --- | --- |");
    for (const entry of blockedThisEpicEntries) {
      const blockers =
        entry.openBlockerIds.length > 0 ? entry.openBlockerIds.join(", ") : "—";
      lines.push(`| #${entry.id} | ${blockers} |`);
    }
  }

  return lines.join("\n");
}

/** Cross-epic visit order and scope — no per-issue lists. */
export function formatProjectContextForPrompt(projectMap: ProjectMap | null): string {
  if (!projectMap) {
    return "Project map not loaded for this session.";
  }

  const lines: string[] = [
    `- Source: GitHub · fetched ${projectMap.fetchedAt}`,
    `- Suggested active epic: ${projectMap.suggestedActiveEpic ?? "—"}`,
    `- Forecast after active: ${projectMap.forecastEpicsAfterActive.join(", ") || "—"}`,
    `- Scoped epics this run: ${projectMap.scopedEpicsToRun.join(", ") || "—"}`,
    `- Completed epics: ${projectMap.completedEpics.join(", ") || "—"}`,
  ];

  if (projectMap.dependencyWorkOrder.length > 0) {
    const order =
      projectMap.dependencyWorkOrder.slice(0, 12).join(" → ") +
      (projectMap.dependencyWorkOrder.length > 12
        ? ` → … +${projectMap.dependencyWorkOrder.length - 12}`
        : "");
    lines.push(`- Visit order: ${order}`);
  }

  return lines.join("\n");
}
