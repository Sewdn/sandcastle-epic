import chalk from "chalk";
import Table from "cli-table3";
import type { BriefIssue } from "./planning.js";
import type { ProjectMap } from "./project-map.js";
import { resolveProjectMapReportSections, type ProjectMapReportOptions } from "./project-map-report.js";

export type DependencyChainStatus = "ready" | "blocked" | "pending_merge";

export type DependencyChainEntry = {
  readonly id: string;
  readonly epic: string;
  readonly title: string;
  readonly status: DependencyChainStatus;
  readonly openBlockerIds: readonly string[];
};

export type OpenIssueHostAnalysis = {
  readonly openIssues: readonly BriefIssue[];
  readonly dependencyChain: readonly DependencyChainEntry[];
  readonly readyNow: readonly DependencyChainEntry[];
  readonly blocked: readonly DependencyChainEntry[];
  readonly pendingMerge: readonly DependencyChainEntry[];
};

function epicOrderIndex(epic: string, canonicalSequence: readonly string[]): number {
  const index = canonicalSequence.indexOf(epic);
  return index >= 0 ? index : Number.MAX_SAFE_INTEGER;
}

function dependencyStatus(issue: BriefIssue): DependencyChainStatus {
  if (issue.status === "pending_merge") {
    return "pending_merge";
  }
  return issue.openBlockerIds.length === 0 ? "ready" : "blocked";
}

function statusRank(status: DependencyChainStatus): number {
  if (status === "ready") {
    return 0;
  }
  if (status === "pending_merge") {
    return 1;
  }
  return 2;
}

/** Deterministic cross-epic order: ready → pending merge → blocked, then epic sequence, then issue id. */
export function orderDependencyChain(
  openIssues: readonly BriefIssue[],
  canonicalSequence: readonly string[],
): DependencyChainEntry[] {
  return [...openIssues]
    .sort((left, right) => {
      const leftStatus = dependencyStatus(left);
      const rightStatus = dependencyStatus(right);
      const byStatus = statusRank(leftStatus) - statusRank(rightStatus);
      if (byStatus !== 0) {
        return byStatus;
      }

      const byEpic =
        epicOrderIndex(left.epic, canonicalSequence) - epicOrderIndex(right.epic, canonicalSequence);
      if (byEpic !== 0) {
        return byEpic;
      }

      return Number(left.id) - Number(right.id);
    })
    .map((issue) => ({
      id: issue.id,
      epic: issue.epic,
      title: issue.title,
      status: dependencyStatus(issue),
      openBlockerIds: issue.openBlockerIds,
    }));
}

export function analyzeOpenIssueDependencies(
  openIssues: readonly BriefIssue[],
  canonicalSequence: readonly string[],
): OpenIssueHostAnalysis {
  const dependencyChain = orderDependencyChain(openIssues, canonicalSequence);
  return {
    openIssues,
    dependencyChain,
    readyNow: dependencyChain.filter((entry) => entry.status === "ready"),
    blocked: dependencyChain.filter((entry) => entry.status === "blocked"),
    pendingMerge: dependencyChain.filter((entry) => entry.status === "pending_merge"),
  };
}

function formatBlockers(blockers: readonly string[]): string {
  if (blockers.length === 0) {
    return chalk.dim("—");
  }
  return blockers.join(", ");
}

function formatStatus(status: DependencyChainStatus): string {
  if (status === "ready") {
    return chalk.green("ready");
  }
  if (status === "pending_merge") {
    return chalk.yellow("pending merge");
  }
  return chalk.red("blocked");
}

function summarizeLaterEntries(entries: readonly DependencyChainEntry[]): string {
  const ready = entries.filter((entry) => entry.status === "ready").length;
  const pending = entries.filter((entry) => entry.status === "pending_merge").length;
  const blocked = entries.filter((entry) => entry.status === "blocked").length;
  return `${ready} ready, ${pending} pending, ${blocked} blocked`;
}

export type DependencyChainReportOptions = ProjectMapReportOptions;

export function printDependencyChainReport(
  analysis: OpenIssueHostAnalysis,
  projectMap: ProjectMap,
  options: DependencyChainReportOptions = {},
): void {
  const detailEpics = new Set(
    resolveProjectMapReportSections(projectMap, options).detailEntries.map((entry) => entry.epic),
  );

  const detail = analysis.dependencyChain.filter((entry) => detailEpics.has(entry.epic));
  const later = analysis.dependencyChain.filter((entry) => !detailEpics.has(entry.epic));

  console.log(chalk.bold("\nSandcastle dependency chain (host · all open issues)"));

  if (analysis.dependencyChain.length === 0) {
    console.log(chalk.dim("  No open ready-for-agent issues in backlog."));
    return;
  }

  const table = new Table({
    head: [
      chalk.cyan.bold("Issue"),
      chalk.cyan.bold("Epic"),
      chalk.cyan.bold("Status"),
      chalk.cyan.bold("Blocked by"),
    ],
  });

  for (const entry of detail) {
    table.push([
      `#${entry.id}`,
      entry.epic,
      formatStatus(entry.status),
      formatBlockers(entry.openBlockerIds),
    ]);
  }

  if (later.length > 0) {
    table.push([
      chalk.dim(`… +${later.length} issues`),
      chalk.dim("later"),
      chalk.dim(summarizeLaterEntries(later)),
      chalk.dim("—"),
    ]);
  }

  console.log(table.toString());
  console.log(
    chalk.dim(
      `  ${analysis.readyNow.length} ready · ${analysis.pendingMerge.length} pending merge · ${analysis.blocked.length} blocked (global)`,
    ),
  );
}
