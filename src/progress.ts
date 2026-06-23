import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { $ } from "bun";

type BranchProgressEntry = {
  readonly reviewedTip: string;
};

type BranchProgressState = Record<string, BranchProgressEntry>;

const stateFilePath = (sandcastleDir: string) =>
  path.join(sandcastleDir, "state", "branch-progress.json");

function loadState(sandcastleDir: string): BranchProgressState {
  try {
    const raw = readFileSync(stateFilePath(sandcastleDir), "utf8");
    return JSON.parse(raw) as BranchProgressState;
  } catch {
    return {};
  }
}

function saveState(sandcastleDir: string, state: BranchProgressState): void {
  const filePath = stateFilePath(sandcastleDir);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export async function branchTipSha(branch: string): Promise<string | null> {
  const result = await $`git rev-parse ${branch}`.quiet().nothrow();
  if (result.exitCode !== 0) {
    return null;
  }
  return result.stdout.toString().trim() || null;
}

export function shouldSkipReview(sandcastleDir: string, branch: string, tip: string): boolean {
  return loadState(sandcastleDir)[branch]?.reviewedTip === tip;
}

export function markReviewed(sandcastleDir: string, branch: string, tip: string): void {
  const state = loadState(sandcastleDir);
  state[branch] = { reviewedTip: tip };
  saveState(sandcastleDir, state);
}

export function clearBranchProgress(sandcastleDir: string, branch: string): void {
  const state = loadState(sandcastleDir);
  if (!(branch in state)) {
    return;
  }
  delete state[branch];
  saveState(sandcastleDir, state);
}
