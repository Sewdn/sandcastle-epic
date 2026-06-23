import { existsSync } from "node:fs";
import path from "node:path";
import { $ } from "bun";
import type { EpicContext } from "./context.js";
import { countCommitsAhead } from "./git.js";

export type GitWorktreeEntry = {
  readonly path: string;
  readonly head: string;
  readonly branch: string | null;
};

export type ReleasedSandcastleWorktree = {
  readonly path: string;
  readonly branch: string | null;
  readonly commitsAhead: number | null;
};

export function sandcastleWorktreesRoot(sandcastleDir: string): string {
  return path.join(path.resolve(sandcastleDir), "worktrees");
}

export function isSandcastleWorktreePath(worktreePath: string, sandcastleDir: string): boolean {
  const root = sandcastleWorktreesRoot(sandcastleDir);
  const resolved = path.resolve(worktreePath);
  return resolved === root || resolved.startsWith(`${root}${path.sep}`);
}

export function isSandcastleIntegrationBranch(branch: string | null): boolean {
  return branch?.startsWith("integrate/epic-") ?? false;
}

export function branchFromRef(ref: string): string {
  const prefix = "refs/heads/";
  return ref.startsWith(prefix) ? ref.slice(prefix.length) : ref;
}

/** Parse `git worktree list --porcelain` output into worktree records. */
export function parseGitWorktreePorcelain(output: string): GitWorktreeEntry[] {
  const entries: GitWorktreeEntry[] = [];
  let current: { path?: string; head?: string; branch?: string | null } = {};

  const flush = () => {
    if (current.path && current.head) {
      entries.push({
        path: current.path,
        head: current.head,
        branch: current.branch ?? null,
      });
    }
    current = {};
  };

  for (const line of output.split("\n")) {
    if (line === "") {
      flush();
      continue;
    }

    if (line.startsWith("worktree ")) {
      if (current.path) {
        flush();
      }
      current.path = line.slice("worktree ".length);
      continue;
    }

    if (line.startsWith("HEAD ")) {
      current.head = line.slice("HEAD ".length);
      continue;
    }

    if (line.startsWith("branch ")) {
      current.branch = branchFromRef(line.slice("branch ".length));
      continue;
    }

    if (line === "detached") {
      current.branch = null;
    }
  }

  flush();
  return entries;
}

export async function listSandcastleWorktrees(sandcastleDir: string): Promise<GitWorktreeEntry[]> {
  const result = await $`git worktree list --porcelain`.quiet().nothrow();
  if (result.exitCode !== 0) {
    throw new Error(
      `git worktree list failed: ${result.stderr.toString().trim() || "unknown error"}`,
    );
  }

  return parseGitWorktreePorcelain(result.stdout.toString()).filter((entry) =>
    isSandcastleWorktreePath(entry.path, sandcastleDir),
  );
}

async function removeWorktree(worktreePath: string): Promise<string | null> {
  const result = await $`git worktree remove --force ${worktreePath}`.quiet().nothrow();
  if (result.exitCode !== 0) {
    return result.stderr.toString().trim() || `failed to remove ${worktreePath}`;
  }
  return null;
}

/**
 * Remove Sandcastle sandbox worktrees from the host repo. Branch refs and commits
 * are preserved; only the linked checkout directories are dropped so host merge
 * can checkout the integration branch and sandboxes can recreate cleanly.
 */
export async function releaseSandcastleWorktrees(
  ctx: EpicContext,
): Promise<readonly ReleasedSandcastleWorktree[]> {
  const { sandcastleDir, integrationBranch } = ctx.config;
  const worktreesRoot = sandcastleWorktreesRoot(sandcastleDir);

  if (!existsSync(worktreesRoot)) {
    return [];
  }

  const sandcastleWorktrees = await listSandcastleWorktrees(sandcastleDir);
  if (sandcastleWorktrees.length === 0) {
    return [];
  }

  const released: ReleasedSandcastleWorktree[] = [];

  for (const entry of sandcastleWorktrees) {
    const commitsAhead =
      entry.branch && !isSandcastleIntegrationBranch(entry.branch)
        ? await countCommitsAhead(ctx, entry.branch)
        : null;

    const label = entry.branch ?? "(detached HEAD)";
    const aheadLabel =
      commitsAhead === null
        ? "sandbox checkout"
        : commitsAhead === 0
          ? "merged"
          : `${commitsAhead} commit(s) ahead of ${integrationBranch}`;

    console.log(`  Releasing worktree ${label} (${aheadLabel})…`);
    const error = await removeWorktree(entry.path);
    if (error) {
      console.error(`    ✗ ${error}`);
    } else {
      released.push({
        path: entry.path,
        branch: entry.branch,
        commitsAhead,
      });
    }
  }

  if (released.length > 0) {
    await $`git worktree prune`.quiet().nothrow();
  }

  return released;
}
