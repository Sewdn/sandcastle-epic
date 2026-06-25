/**
 * @deprecated Epic completion is derived from GitHub via {@link loadProjectMapFromGithub}.
 * Local `completed-epics.json` is no longer written or read by the orchestrator.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ProjectMap } from "./project-map.js";
import { filterEpicsFromProjectMap } from "./project-map.js";

type CompletedEpicsState = {
  readonly completedEpics: string[];
  readonly recordedAt: Record<string, string>;
};

const stateFilePath = (sandcastleDir: string) =>
  path.join(sandcastleDir, "state", "completed-epics.json");

/** Repo-relative path to legacy completed-epics state (checkout cleanup only). */
export function completedEpicsStateRelPath(
  repoRoot: string,
  sandcastleDir: string,
): string {
  return path.relative(repoRoot, stateFilePath(sandcastleDir)).split(path.sep).join("/");
}

function loadLegacyState(sandcastleDir: string): CompletedEpicsState {
  try {
    const raw = readFileSync(stateFilePath(sandcastleDir), "utf8");
    const parsed = JSON.parse(raw) as CompletedEpicsState;
    return {
      completedEpics: [...new Set(parsed.completedEpics ?? [])],
      recordedAt: parsed.recordedAt ?? {},
    };
  } catch {
    return { completedEpics: [], recordedAt: {} };
  }
}

/** @deprecated Use {@link ProjectMap.completedEpics} from GitHub instead. */
export function loadCompletedEpics(sandcastleDir: string): readonly string[] {
  console.warn(
    "loadCompletedEpics is deprecated — epic completion now comes from GitHub project map.",
  );
  return loadLegacyState(sandcastleDir).completedEpics;
}

/** @deprecated Use GitHub project map instead. */
export function isEpicCompleted(sandcastleDir: string, epic: string): boolean {
  return loadCompletedEpics(sandcastleDir).includes(epic);
}

/** Last completed epic in order that precedes `epic`. */
export function priorCompletedEpic(
  epic: string,
  completed: readonly string[],
  epicSequence: readonly string[],
  canonicalSequence?: readonly string[],
): string | null {
  const completedSet = new Set(completed);
  const lookupSequence = canonicalSequence ?? epicSequence;
  const index = lookupSequence.indexOf(epic);
  if (index <= 0) {
    return null;
  }

  for (let i = index - 1; i >= 0; i--) {
    const candidate = lookupSequence[i]!;
    if (completedSet.has(candidate)) {
      return candidate;
    }
  }

  return null;
}

/** @deprecated Use {@link filterEpicsFromProjectMap} with a GitHub project map instead. */
export function filterEpicsToRun(
  epics: readonly string[],
  sandcastleDir: string,
): { readonly toRun: readonly string[]; readonly skipped: readonly string[] } {
  console.warn(
    "filterEpicsToRun(sandcastleDir) is deprecated — use filterEpicsFromProjectMap with GitHub state.",
  );
  const completed = new Set(loadLegacyState(sandcastleDir).completedEpics);
  return {
    skipped: epics.filter((epic) => completed.has(epic)),
    toRun: epics.filter((epic) => !completed.has(epic)),
  };
}

/** @deprecated No-op — GitHub is the source of truth for epic completion. */
export function markEpicCompleted(_sandcastleDir: string, _epic: string): void {
  // intentionally empty
}

/** @deprecated Legacy local state only. */
export function clearEpicCompleted(sandcastleDir: string, epic: string): void {
  const state = loadLegacyState(sandcastleDir);
  if (!state.completedEpics.includes(epic)) {
    return;
  }

  const { [epic]: _removed, ...recordedAt } = state.recordedAt;
  const filePath = stateFilePath(sandcastleDir);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(
    filePath,
    `${JSON.stringify(
      {
        completedEpics: state.completedEpics.filter((item) => item !== epic),
        recordedAt,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

export { filterEpicsFromProjectMap, type ProjectMap };
