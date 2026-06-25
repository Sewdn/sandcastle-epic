import chalk from "chalk";
import Table from "cli-table3";
import { clusterLabel } from "./cluster/helpers.js";
import type { EpicBrief } from "./planning.js";
import type { ProjectMap } from "./project-map.js";
import { resolveParallelClusterConfig, type ParallelClusterConfig } from "./parallel.js";
import type { IssueCluster } from "./types.js";
import type { ProjectMapReportOptions } from "./project-map-report.js";

export type PlannerReportOptions = ProjectMapReportOptions;

export type EpicPlanSource = "planner-agent" | "host-suggested" | "host-fallback";

export type EpicPlanReportOptions = {
  readonly epicLabel: string;
  readonly source: EpicPlanSource;
  readonly parallelConfig?: ParallelClusterConfig;
};

function formatSkills(skills: readonly string[] | undefined): string {
  if (!skills || skills.length === 0) {
    return chalk.dim("—");
  }
  return skills.join(", ");
}

function formatSource(source: EpicPlanSource): string {
  if (source === "planner-agent") {
    return chalk.green("planner agent");
  }
  if (source === "host-suggested") {
    return chalk.yellow("host suggested");
  }
  return chalk.dim("host fallback");
}

function executionMode(
  clusters: readonly IssueCluster[],
  parallel: ParallelClusterConfig,
): string {
  if (clusters.length <= 1) {
    return "sequential (1 run)";
  }
  if (parallel.enabled && parallel.limit > 1) {
    return `parallel (max ${Math.min(parallel.limit, clusters.length)} concurrent)`;
  }
  return "sequential";
}

function parallelHintForIssue(brief: EpicBrief, issueId: string): string {
  const issue = brief.openIssues.find((entry) => entry.id === issueId);
  return issue?.parallel ? chalk.green("yes") : chalk.dim("no");
}

/** Host-computed dependency baseline and default clustering (planner agent may revise). */
export function printHostPlannerBaselineReport(
  brief: EpicBrief,
  projectMap: ProjectMap | null = null,
  _options: PlannerReportOptions = {},
): void {
  const currentEpicOpen = brief.openIssues.filter((issue) => issue.epic === brief.epic);
  const readyThisEpic = brief.hostAnalysis.unblockedForCurrentEpic.length;
  const blockedThisEpic = brief.hostAnalysis.blocked.filter(
    (entry) => entry.epic === brief.epic,
  ).length;

  console.log(chalk.bold("\nSandcastle host planner (deterministic baseline)"));
  console.log(
    chalk.dim(
      "  Input for the planner agent — dependency review, clustering, and parallelization may differ.",
    ),
  );

  const summary = new Table({ head: [chalk.cyan.bold("Field"), chalk.cyan.bold("Value")] });
  summary.push(
    ["Epic", chalk.bold.cyan(brief.epicLabel)],
    ["Integration branch", brief.integrationBranch],
    ["Open issues", `${brief.openIssues.length} global · ${currentEpicOpen.length} this epic`],
    [
      "Host ready",
      `${brief.hostAnalysis.readyNow.length} global · ${readyThisEpic} this epic`,
    ],
    ["Host blocked", `${brief.hostAnalysis.blocked.length} global · ${blockedThisEpic} this epic`],
    ["Pending merge (this epic)", String(brief.pendingMerge.length)],
  );
  if (projectMap?.suggestedActiveEpic) {
    summary.push(["Suggested active epic", projectMap.suggestedActiveEpic]);
  }
  console.log(summary.toString());

  if (brief.hostAnalysis.unblockedForCurrentEpic.length > 0) {
    const readyTable = new Table({
      head: [
        chalk.cyan.bold("Issue"),
        chalk.cyan.bold("Parallel"),
        chalk.cyan.bold("Branch"),
        chalk.cyan.bold("Title"),
      ],
    });

    for (const issue of brief.hostAnalysis.unblockedForCurrentEpic) {
      readyTable.push([
        `#${issue.id}`,
        parallelHintForIssue(brief, issue.id),
        issue.branch,
        issue.title,
      ]);
    }

    console.log(chalk.bold("\nReady for this epic (host)"));
    console.log(readyTable.toString());
  } else {
    console.log(chalk.dim("\n  No host-ready issues on this epic."));
  }

  if (brief.hostAnalysis.suggestedClusters.length > 0) {
    const clusterTable = new Table({
      head: [chalk.cyan.bold("Run"), chalk.cyan.bold("Issues"), chalk.cyan.bold("Reason")],
    });

    for (const [index, cluster] of brief.hostAnalysis.suggestedClusters.entries()) {
      clusterTable.push([String(index + 1), clusterLabel(cluster), cluster.reason]);
    }

    console.log(chalk.bold("\nHost-suggested clusters (default: one issue per run)"));
    console.log(clusterTable.toString());
  }

  const blockedThisEpicEntries = brief.hostAnalysis.blocked.filter(
    (entry) => entry.epic === brief.epic,
  );
  if (blockedThisEpicEntries.length > 0) {
    const blockedTable = new Table({
      head: [chalk.cyan.bold("Issue"), chalk.cyan.bold("Blocked by")],
    });

    for (const entry of blockedThisEpicEntries) {
      blockedTable.push([
        `#${entry.id}`,
        entry.openBlockerIds.length > 0 ? entry.openBlockerIds.join(", ") : chalk.dim("—"),
      ]);
    }

    console.log(chalk.bold("\nBlocked on this epic (host · cross-epic)"));
    console.log(blockedTable.toString());
  }
}

/** Final epic plan after planner agent (or host fallback). */
export function printEpicPlanReport(
  clusters: readonly IssueCluster[],
  options: EpicPlanReportOptions,
): void {
  const parallel = options.parallelConfig ?? resolveParallelClusterConfig();

  console.log(chalk.bold("\nSandcastle epic plan"));
  console.log(
    chalk.dim(
      `  Source: ${formatSource(options.source)} · ${options.epicLabel} · ${executionMode(clusters, parallel)}`,
    ),
  );

  if (clusters.length === 0) {
    console.log(chalk.dim("  No implementer runs scheduled."));
    return;
  }

  const table = new Table({
    head: [
      chalk.cyan.bold("Run"),
      chalk.cyan.bold("Issues"),
      chalk.cyan.bold("Implement skills"),
      chalk.cyan.bold("Review skills"),
      chalk.cyan.bold("Reason"),
    ],
  });

  for (const [index, cluster] of clusters.entries()) {
    table.push([
      String(index + 1),
      clusterLabel(cluster),
      formatSkills(cluster.skills?.implementation),
      formatSkills(cluster.skills?.review),
      cluster.reason,
    ]);
  }

  console.log(table.toString());

  const issueCount = clusters.reduce((total, cluster) => total + cluster.issues.length, 0);
  console.log(
    chalk.dim(`  ${issueCount} issue(s) · ${clusters.length} implementer run(s) → review → merge`),
  );
}
