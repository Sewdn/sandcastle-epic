import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { $ } from "bun";
import type { EpicContext } from "./context.js";
import { sandcastleWorktreesRoot } from "./worktrees.js";

let doraIndexQueue: Promise<void> = Promise.resolve();

function withDoraIndexLock<T>(run: () => Promise<T>): Promise<T> {
  const task = doraIndexQueue.then(run, run);
  doraIndexQueue = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}

type DoraConfig = {
  root: string;
  scip: string;
  db: string;
  commands?: { index?: string };
  lastIndexed?: string;
};

function branchWorktreeDir(sandcastleDir: string, branch: string): string {
  const safe = branch.replace(/[/\\:*?"<>|]/g, "-");
  return path.join(sandcastleWorktreesRoot(sandcastleDir), safe);
}

/** Resolve a checkout path for indexing: Sandcastle worktree when present, else repo root. */
export function resolveIndexCheckoutPath(
  repoRoot: string,
  sandcastleDir: string,
  branch?: string,
): string {
  if (!branch) {
    return repoRoot;
  }

  const worktree = branchWorktreeDir(sandcastleDir, branch);
  if (existsSync(worktree)) {
    return worktree;
  }

  return repoRoot;
}

function loadDoraConfig(configPath: string): DoraConfig {
  return JSON.parse(readFileSync(configPath, "utf8")) as DoraConfig;
}

function saveDoraConfig(configPath: string, config: DoraConfig): void {
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

/** Host-side index command — use Bun's executable path so dora spawn does not rely on PATH. */
export function hostDoraIndexCommand(repoRoot: string): string {
  return `${process.execPath} ${path.join(repoRoot, ".scripts/dora-index.mjs")}`;
}

/** Patch shared `.dora/config.json` so host indexing writes to repo root while reading branch sources. */
export function patchDoraConfigForHostIndex(
  config: DoraConfig,
  repoRoot: string,
  checkout: string,
): DoraConfig {
  return {
    ...config,
    root: checkout,
    scip: path.join(repoRoot, ".dora/index.scip"),
    db: path.join(repoRoot, ".dora/dora.db"),
    commands: {
      ...config.commands,
      index: hostDoraIndexCommand(repoRoot),
    },
  };
}

/** Refresh the shared host `.dora` index for a repo checkout path. */
export async function refreshDoraIndexForRepo(
  repoRoot: string,
  sandcastleDir: string,
  branch?: string,
): Promise<void> {
  await withDoraIndexLock(async () => {
    const resolvedRepoRoot = path.resolve(repoRoot);
    const configPath = path.join(resolvedRepoRoot, ".dora/config.json");
    if (!existsSync(configPath)) {
      console.log("  Skipping Dora index refresh — no .dora directory at repo root.");
      return;
    }

    const checkout = resolveIndexCheckoutPath(resolvedRepoRoot, sandcastleDir, branch);
    console.log(`  Refreshing shared Dora index (${branch ?? "repo root"} @ ${checkout})…`);

    const original = loadDoraConfig(configPath);
    saveDoraConfig(configPath, patchDoraConfigForHostIndex(original, resolvedRepoRoot, checkout));

    try {
      const result = await $`dora index`
        .cwd(resolvedRepoRoot)
        .env({ ...process.env, DORA_REPO_ROOT: resolvedRepoRoot })
        .quiet()
        .nothrow();
      if (result.exitCode !== 0) {
        const detail = result.stderr.toString().trim() || result.stdout.toString().trim();
        throw new Error(detail || "dora index failed");
      }

      console.log("  Dora index refresh complete.");
    } finally {
      const refreshed = loadDoraConfig(configPath);
      saveDoraConfig(configPath, {
        ...original,
        lastIndexed: refreshed.lastIndexed ?? original.lastIndexed,
      });
    }
  });
}

/** Refresh the shared host Dora index after code-changing agent steps. */
export async function refreshDoraIndex(
  ctx: EpicContext,
  branch?: string,
): Promise<void> {
  try {
    await refreshDoraIndexForRepo(ctx.config.repoRoot, ctx.config.sandcastleDir, branch);
  } catch (error) {
    console.warn(`  Dora index refresh failed (non-fatal): ${error}`);
  }
}
