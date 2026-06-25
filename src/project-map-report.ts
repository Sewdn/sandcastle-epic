import chalk from "chalk";
import Table from "cli-table3";
import type { OpenIssueHostAnalysis } from "./dependency-chain-report.js";
import { deriveEpicWorkOrder, deriveForecastEpicsAfterAnchor } from "./epic-work-order.js";
import type { EpicProjectEntry, ProjectMap } from "./project-map.js";

/** Anchor epic plus the next two forecast epics shown in full detail. */
const DEFAULT_DETAIL_EPIC_COUNT = 3;
const DEFAULT_MAX_EPIC_LABELS = 2;
const DEFAULT_MAX_ISSUE_IDS = 4;

export type ProjectMapReportOptions = {
  /** Epics in the current run scope (longrun phase/list). */
  readonly scopedEpics?: readonly string[];
  /** Epics to emphasize in the table (current or next epic). */
  readonly highlightEpics?: readonly string[];
  /** How many epics from the anchor to show as full rows (default: now + next 2). */
  readonly detailEpicCount?: number;
  /** Max epic slugs in the collapsed “later” row before "+N epics". */
  readonly maxEpicLabels?: number;
  /** Max issue ids in the collapsed “later” row before "+N more". */
  readonly maxIssueIds?: number;
  /** Host dependency analysis — enables Ready/Blocked columns when set. */
  readonly dependencyAnalysis?: OpenIssueHostAnalysis;
  readonly title?: string;
};

export type ProjectMapReportSections = {
  readonly detailEntries: readonly EpicProjectEntry[];
  readonly laterEntries: readonly EpicProjectEntry[];
  readonly anchorEpic: string | null;
};

function epicEntry(projectMap: ProjectMap, epic: string): EpicProjectEntry | undefined {
  return projectMap.epics.find((entry) => entry.epic === epic);
}

function resolveAnchorEpic(
  projectMap: ProjectMap,
  options: ProjectMapReportOptions,
  queue: readonly string[],
): string | null {
  return (
    options.highlightEpics?.find((epic) => queue.includes(epic)) ??
    (projectMap.suggestedActiveEpic && queue.includes(projectMap.suggestedActiveEpic)
      ? projectMap.suggestedActiveEpic
      : null) ??
    queue[0] ??
    null
  );
}

function resolveDetailEpicSlugs(
  projectMap: ProjectMap,
  options: ProjectMapReportOptions,
  anchorEpic: string,
  detailCount: number,
): readonly string[] {
  const forecastCount = Math.max(0, detailCount - 1);

  if (options.dependencyAnalysis && forecastCount > 0) {
    const forecast =
      projectMap.forecastEpicsAfterActive.length > 0
        ? projectMap.forecastEpicsAfterActive.slice(0, forecastCount)
        : deriveForecastEpicsAfterAnchor(
            options.dependencyAnalysis,
            projectMap,
            anchorEpic,
            forecastCount,
            options.scopedEpics,
          );
    return [anchorEpic, ...forecast];
  }

  const scoped = options.scopedEpics ?? projectMap.scopedEpics;
  const scopedSet = new Set(scoped);
  const baseQueue =
    projectMap.dependencyWorkOrder.length > 0
      ? projectMap.dependencyWorkOrder
      : projectMap.scopedEpicsToRun;
  const queue = baseQueue.filter((epic) => scopedSet.size === 0 || scopedSet.has(epic));
  const anchorIndex = queue.indexOf(anchorEpic);
  const startIndex = anchorIndex >= 0 ? anchorIndex : 0;

  return queue.slice(startIndex, startIndex + detailCount);
}

function resolveVisitOrder(
  projectMap: ProjectMap,
  scopedEpics: readonly string[],
): readonly string[] {
  const scopedSet = new Set(scopedEpics);
  const base =
    projectMap.dependencyWorkOrder.length > 0
      ? projectMap.dependencyWorkOrder
      : projectMap.scopedEpicsToRun;

  return base.filter((epic) => scopedSet.size === 0 || scopedSet.has(epic));
}

/** Split the report into detailed near-term epics and a collapsed later tail. */
export function resolveProjectMapReportSections(
  projectMap: ProjectMap,
  options: ProjectMapReportOptions = {},
): ProjectMapReportSections {
  const detailCount = Math.max(1, options.detailEpicCount ?? DEFAULT_DETAIL_EPIC_COUNT);
  const scoped = options.scopedEpics ?? projectMap.scopedEpics;
  const visitOrder = resolveVisitOrder(projectMap, scoped);
  const openEpics = visitOrder.filter(
    (epic) => epicEntry(projectMap, epic)?.status === "has_work",
  );

  const anchorEpic = resolveAnchorEpic(projectMap, options, openEpics);

  if (!anchorEpic) {
    return { detailEntries: [], laterEntries: [], anchorEpic: null };
  }

  const detailSlugs = resolveDetailEpicSlugs(projectMap, options, anchorEpic, detailCount);
  const detailSet = new Set(detailSlugs);

  const detailEntries = detailSlugs
    .map((epic) => epicEntry(projectMap, epic))
    .filter((entry): entry is EpicProjectEntry => entry !== undefined && entry.status === "has_work");

  const laterEntries = openEpics
    .filter((epic) => !detailSet.has(epic))
    .map((epic) => epicEntry(projectMap, epic))
    .filter((entry): entry is EpicProjectEntry => entry !== undefined);

  return {
    detailEntries,
    laterEntries,
    anchorEpic,
  };
}

/** @deprecated Use {@link resolveProjectMapReportSections}. */
export type ProjectMapReportWindow = {
  readonly entries: readonly EpicProjectEntry[];
  readonly remainingEpics: number;
  readonly anchorEpic: string | null;
};

/** @deprecated Use {@link resolveProjectMapReportSections}. */
export function resolveProjectMapReportWindow(
  projectMap: ProjectMap,
  options: ProjectMapReportOptions = {},
): ProjectMapReportWindow {
  const { detailEntries, laterEntries, anchorEpic } = resolveProjectMapReportSections(
    projectMap,
    options,
  );
  return {
    entries: [...detailEntries, ...laterEntries],
    remainingEpics: laterEntries.length,
    anchorEpic,
  };
}

/** Collapse epic slugs for a compact table cell. */
export function collapseEpicLabels(
  epics: readonly string[],
  maxLabels = DEFAULT_MAX_EPIC_LABELS,
): string {
  if (epics.length === 0) {
    return chalk.dim("—");
  }
  if (epics.length <= maxLabels) {
    return epics.join(", ");
  }
  const shown = epics.slice(0, maxLabels);
  return `${shown.join(", ")} +${epics.length - maxLabels} epics`;
}

/** Collapse open issue ids across epics for a compact table cell. */
export function collapseIssueIds(
  entries: readonly EpicProjectEntry[],
  maxIds = DEFAULT_MAX_ISSUE_IDS,
): { readonly count: number; readonly display: string } {
  const ids = entries.flatMap((entry) => entry.openReadyForAgent.map((issue) => issue.id));
  const count = ids.length;
  if (count === 0) {
    return { count: 0, display: chalk.dim("—") };
  }

  const shown = ids.slice(0, maxIds).map((id) => `#${id}`);
  if (count <= maxIds) {
    return { count, display: shown.join(", ") };
  }

  return { count, display: `${shown.join(", ")} … +${count - maxIds} more` };
}

function formatIssueList(entry: EpicProjectEntry): string {
  if (entry.openReadyCount === 0) {
    return chalk.dim("—");
  }
  return entry.openReadyForAgent.map((issue) => `#${issue.id}`).join(", ");
}

function detailEpicLabel(epic: string, index: number, highlights: ReadonlySet<string>): string {
  const suffix =
    index === 0 ? " · now" : index === 1 ? " · +1" : index === 2 ? " · +2" : "";
  const value = `${epic}${suffix}`;
  if (index === 0 || highlights.has(epic)) {
    return chalk.bold.cyan(value);
  }
  return value;
}

function readyBlockedCell(
  epic: string,
  dependencyAnalysis: OpenIssueHostAnalysis | undefined,
  projectMap: ProjectMap,
): string {
  if (!dependencyAnalysis) {
    return chalk.dim("—");
  }
  const entry = deriveEpicWorkOrder(dependencyAnalysis, projectMap).entries.find(
    (item) => item.epic === epic,
  );
  if (!entry) {
    return chalk.dim("—");
  }
  return `${chalk.green(String(entry.readyCount))} / ${chalk.red(String(entry.blockedCount))}`;
}

export function printProjectMapReport(
  projectMap: ProjectMap,
  options: ProjectMapReportOptions = {},
): void {
  const highlights = new Set(options.highlightEpics ?? []);
  const maxEpicLabels = options.maxEpicLabels ?? DEFAULT_MAX_EPIC_LABELS;
  const maxIssueIds = options.maxIssueIds ?? DEFAULT_MAX_ISSUE_IDS;
  const { detailEntries, laterEntries, anchorEpic } = resolveProjectMapReportSections(
    projectMap,
    options,
  );

  const title = options.title ?? "Sandcastle project state";
  console.log(chalk.bold(`\n${title}`));

  if (detailEntries.length === 0 && laterEntries.length === 0) {
    console.log(chalk.dim("  No open ready-for-agent work in the current window."));
    return;
  }

  const showHostReady = options.dependencyAnalysis !== undefined;
  const table = new Table({
    head: [
      chalk.cyan.bold("Epic"),
      ...(showHostReady ? [chalk.cyan.bold("Ready/Blocked")] : []),
      chalk.cyan.bold("Open"),
      chalk.cyan.bold("Issues"),
    ],
  });

  for (const [index, entry] of detailEntries.entries()) {
    table.push([
      detailEpicLabel(entry.epic, index, highlights),
      ...(showHostReady
        ? [readyBlockedCell(entry.epic, options.dependencyAnalysis, projectMap)]
        : []),
      String(entry.openReadyCount),
      formatIssueList(entry),
    ]);
  }

  if (laterEntries.length > 0) {
    const laterEpics = laterEntries.map((entry) => entry.epic);
    const { count, display } = collapseIssueIds(laterEntries, maxIssueIds);
    table.push([
      chalk.dim(`${collapseEpicLabels(laterEpics, maxEpicLabels)} · later`),
      ...(showHostReady ? [chalk.dim("—")] : []),
      chalk.dim(String(count)),
      chalk.dim(display),
    ]);
  }

  console.log(table.toString());

  const orderHint =
    projectMap.dependencyWorkOrder.length > 0
      ? projectMap.dependencyWorkOrder.slice(0, 6).join(" → ") +
        (projectMap.dependencyWorkOrder.length > 6
          ? ` → … +${projectMap.dependencyWorkOrder.length - 6}`
          : "")
      : null;

  const forecastHint =
    projectMap.forecastEpicsAfterActive.length > 0
      ? projectMap.forecastEpicsAfterActive.join(", ")
      : null;

  console.log(
    chalk.dim(`  Source: GitHub · fetched ${projectMap.fetchedAt}`) +
      (anchorEpic ? chalk.dim(` · work on ${anchorEpic} first`) : "") +
      (forecastHint ? chalk.dim(` · next after ${anchorEpic}: ${forecastHint}`) : "") +
      (orderHint ? chalk.dim(` · visit order: ${orderHint}`) : ""),
  );
}
