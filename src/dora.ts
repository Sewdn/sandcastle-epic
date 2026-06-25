import { existsSync } from "node:fs";
import path from "node:path";
import { $ } from "bun";
import type { EpicContext } from "./context.js";
import { sandcastleWorktreesRoot } from "./worktrees.js";

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

/** Refresh the shared host Dora index after code-changing agent steps. */
export async function refreshDoraIndex(
  ctx: EpicContext,
  branch?: string,
): Promise<void> {
  const doraDir = path.join(ctx.config.repoRoot, ".dora");
  if (!existsSync(doraDir)) {
    console.log("  Skipping Dora index refresh — no .dora directory at repo root.");
    return;
  }

  const checkout = resolveIndexCheckoutPath(ctx.config.repoRoot, ctx.config.sandcastleDir, branch);
  console.log(`  Refreshing shared Dora index (${branch ?? "repo root"} @ ${checkout})…`);

  const result = await $`dora index`.cwd(checkout).quiet().nothrow();
  if (result.exitCode !== 0) {
    const detail = result.stderr.toString().trim() || result.stdout.toString().trim();
    console.warn(`  Dora index refresh failed (non-fatal): ${detail}`);
    return;
  }

  console.log("  Dora index refresh complete.");
}
