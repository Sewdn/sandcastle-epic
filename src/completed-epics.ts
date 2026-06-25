import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

type CompletedEpicsState = {
  readonly completedEpics: string[];
  readonly recordedAt: Record<string, string>;
};

const stateFilePath = (sandcastleDir: string) =>
  path.join(sandcastleDir, "state", "completed-epics.json");

/** Repo-relative path to completed-epics state (for git checkout cleanup). */
export function completedEpicsStateRelPath(
  repoRoot: string,
  sandcastleDir: string,
): string {
  return path.relative(repoRoot, stateFilePath(sandcastleDir)).split(path.sep).join("/");
}

function loadState(sandcastleDir: string): CompletedEpicsState {
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

function saveState(sandcastleDir: string, state: CompletedEpicsState): void {
  const filePath = stateFilePath(sandcastleDir);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export function loadCompletedEpics(sandcastleDir: string): readonly string[] {
  return loadState(sandcastleDir).completedEpics;
}

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

export function filterEpicsToRun(
  epics: readonly string[],
  sandcastleDir: string,
): { readonly toRun: readonly string[]; readonly skipped: readonly string[] } {
  const completed = new Set(loadCompletedEpics(sandcastleDir));
  const skipped = epics.filter((epic) => completed.has(epic));
  const toRun = epics.filter((epic) => !completed.has(epic));
  return { toRun, skipped };
}

export function markEpicCompleted(sandcastleDir: string, epic: string): void {
  const state = loadState(sandcastleDir);
  if (state.completedEpics.includes(epic)) {
    return;
  }

  saveState(sandcastleDir, {
    completedEpics: [...state.completedEpics, epic],
    recordedAt: { ...state.recordedAt, [epic]: new Date().toISOString() },
  });
}

export function clearEpicCompleted(sandcastleDir: string, epic: string): void {
  const state = loadState(sandcastleDir);
  if (!state.completedEpics.includes(epic)) {
    return;
  }

  const { [epic]: _removed, ...recordedAt } = state.recordedAt;
  saveState(sandcastleDir, {
    completedEpics: state.completedEpics.filter((item) => item !== epic),
    recordedAt,
  });
}
