import { existsSync } from "node:fs";
import type { EpicContext } from "./context.js";
import { releaseSandcastleWorktrees } from "./worktrees.js";

export type SandcastlePreflightResult = {
  readonly released: readonly { readonly path: string; readonly branch: string | null }[];
};

function logPreflightHeader(integrationBranch: string): void {
  console.log(`\nSandcastle preflight — worktrees vs ${integrationBranch}…`);
}

/** Release Sandcastle worktrees before host git operations for this epic. */
export async function runSandcastlePreflight(ctx: EpicContext): Promise<SandcastlePreflightResult> {
  logPreflightHeader(ctx.config.integrationBranch);

  const worktreesDir = `${ctx.config.sandcastleDir}/worktrees`;
  if (!existsSync(worktreesDir)) {
    console.log("  No .sandcastle/worktrees directory — nothing to release.");
    return { released: [] };
  }

  const released = await releaseSandcastleWorktrees(ctx);

  if (released.length === 0) {
    console.log("  No Sandcastle worktrees registered with git.");
  } else {
    console.log(`  Preflight complete: ${released.length} worktree(s) released.`);
  }

  return {
    released: released.map((entry) => ({ path: entry.path, branch: entry.branch })),
  };
}
