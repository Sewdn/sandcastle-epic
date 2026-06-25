import chalk from "chalk";
import Table from "cli-table3";
import type { EpicWorkOrder } from "./epic-work-order.js";

export type EpicWorkOrderReportOptions = {
  readonly highlightEpics?: readonly string[];
  readonly title?: string;
};

function dependsOnLabel(epics: readonly string[]): string {
  if (epics.length === 0) {
    return chalk.dim("—");
  }
  return epics.map((epic) => chalk.yellow(epic)).join(", ");
}

/** Deterministic epic visit order and cross-epic integration dependencies. */
export function printEpicWorkOrderReport(
  workOrder: EpicWorkOrder,
  options: EpicWorkOrderReportOptions = {},
): void {
  const title = options.title ?? "Sandcastle epic work order (host · deterministic)";
  console.log(chalk.bold(`\n${title}`));
  console.log(
    chalk.dim(
      "  Visit order and upstream integration branches derived from open issue blockers — no planner agent.",
    ),
  );

  if (workOrder.workOrder.length === 0) {
    console.log(chalk.dim("  No epics with open work in scope."));
    return;
  }

  const highlight = new Set(options.highlightEpics ?? []);
  const table = new Table({
    head: [
      chalk.cyan.bold("#"),
      chalk.cyan.bold("Epic"),
      chalk.cyan.bold("Depends on"),
      chalk.cyan.bold("Ready"),
      chalk.cyan.bold("Pending"),
      chalk.cyan.bold("Blocked"),
    ],
  });

  for (const [index, epic] of workOrder.workOrder.entries()) {
    const entry = workOrder.entries.find((item) => item.epic === epic);
    if (!entry) {
      continue;
    }

    const epicCell = highlight.has(epic) ? chalk.bold.cyan(epic) : epic;
    table.push([
      String(index + 1),
      epicCell,
      dependsOnLabel(entry.dependsOnEpics),
      String(entry.readyCount),
      String(entry.pendingMergeCount),
      String(entry.blockedCount),
    ]);
  }

  console.log(table.toString());

  if (workOrder.suggestedActiveEpic) {
    console.log(
      chalk.dim(`  Suggested active epic: ${chalk.cyan(workOrder.suggestedActiveEpic)}`),
    );
  }
}
