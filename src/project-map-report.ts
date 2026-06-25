import chalk from "chalk";
import Table from "cli-table3";
import type { EpicProjectEntry, EpicProjectStatus, ProjectMap } from "./project-map.js";

export type ProjectMapReportOptions = {
  /** Epics in the current run scope (longrun phase/list). */
  readonly scopedEpics?: readonly string[];
  /** Epics to emphasize in the table (current or next epic). */
  readonly highlightEpics?: readonly string[];
  readonly title?: string;
};

function colorStatus(status: EpicProjectStatus): string {
  if (status === "complete") {
    return chalk.green("complete");
  }
  return chalk.yellow("has work");
}

function formatIssues(entry: EpicProjectEntry): string {
  if (entry.openReadyCount === 0) {
    return chalk.dim("—");
  }
  return entry.openReadyForAgent.map((issue) => `#${issue.id}`).join(", ");
}

function formatRunScope(
  epic: string,
  projectMap: ProjectMap,
  scopedEpics: ReadonlySet<string>,
): string {
  if (scopedEpics.size > 0 && !scopedEpics.has(epic)) {
    return chalk.dim("—");
  }
  if (projectMap.scopedEpicsSkipped.includes(epic)) {
    return chalk.dim("skip");
  }
  if (projectMap.scopedEpicsToRun.includes(epic)) {
    return chalk.cyan("queued");
  }
  return chalk.dim("—");
}

function highlightEpicCell(value: string, epic: string, highlights: ReadonlySet<string>): string {
  return highlights.has(epic) ? chalk.bold.cyan(value) : value;
}

export function printProjectMapReport(
  projectMap: ProjectMap,
  options: ProjectMapReportOptions = {},
): void {
  const scopedEpics = new Set(options.scopedEpics ?? projectMap.scopedEpics);
  const highlights = new Set(options.highlightEpics ?? []);
  const showRunScope = scopedEpics.size > 0;

  const table = new Table({
    head: [
      chalk.cyan.bold("Epic"),
      chalk.cyan.bold("Status"),
      chalk.cyan.bold("Open"),
      ...(showRunScope ? [chalk.cyan.bold("Run")] : []),
      chalk.cyan.bold("Ready-for-agent issues"),
    ],
  });

  for (const entry of projectMap.epics) {
    const inScope = scopedEpics.size === 0 || scopedEpics.has(entry.epic);
    if (scopedEpics.size > 0 && !inScope) {
      continue;
    }

    table.push([
      highlightEpicCell(entry.epic, entry.epic, highlights),
      colorStatus(entry.status),
      String(entry.openReadyCount),
      ...(showRunScope ? [formatRunScope(entry.epic, projectMap, scopedEpics)] : []),
      formatIssues(entry),
    ]);
  }

  const title = options.title ?? "Sandcastle project state (GitHub)";
  console.log(chalk.bold(`\n${title}`));
  console.log(table.toString());

  console.log(
    chalk.dim(
      `  Source: GitHub · fetched ${projectMap.fetchedAt} · suggested active epic: ${projectMap.suggestedActiveEpic ?? "(none)"}`,
    ),
  );

  if (projectMap.scopedEpicsSkipped.length > 0) {
    console.log(
      chalk.dim(`  Skipped (GitHub-complete in scope): ${projectMap.scopedEpicsSkipped.join(", ")}`,
      ),
    );
  }
  if (projectMap.scopedEpicsToRun.length > 0) {
    console.log(chalk.dim(`  Queued in scope: ${projectMap.scopedEpicsToRun.join(" → ")}`));
  }
}
