import { $ } from "bun";
import { completedEpicsStateRelPath } from "./completed-epics.js";
import type { EpicContext } from "./context.js";
import { clearBranchProgress } from "./progress.js";
import type { PlannedIssue } from "./types.js";

export async function countCommitsAhead(
  ctx: EpicContext,
  branch: string,
  base?: string,
): Promise<number> {
  const integrationBranch = base ?? ctx.config.integrationBranch;
  const result = await $`git rev-parse --verify ${branch}`.quiet().nothrow();
  if (result.exitCode !== 0) {
    return 0;
  }
  const countResult = await $`git rev-list --count ${integrationBranch}..${branch}`
    .quiet()
    .nothrow();
  if (countResult.exitCode !== 0) {
    return 0;
  }
  const count = Number(countResult.stdout.toString().trim());
  return Number.isFinite(count) ? count : 0;
}

export async function issuesWithCommits(
  ctx: EpicContext,
  issues: PlannedIssue[],
): Promise<PlannedIssue[]> {
  const ready: PlannedIssue[] = [];
  for (const issue of issues) {
    if ((await countCommitsAhead(ctx, issue.branch)) > 0) {
      ready.push(issue);
    }
  }
  return ready;
}

/** Host-generated paths that block merges when left dirty after bun install. */
const HOST_MERGE_BLOCKER_PATHS = ["bun.lock"] as const;

async function discardDirtyPaths(repoRoot: string, relPaths: readonly string[]): Promise<void> {
  for (const relPath of relPaths) {
    const status = await $`git status --porcelain ${relPath}`.cwd(repoRoot).quiet().nothrow();
    if (!status.stdout.toString().trim()) {
      continue;
    }

    console.log(`  Discarding local ${relPath} changes before host git step…`);
    await $`git checkout -- ${relPath}`.cwd(repoRoot).quiet().nothrow();
  }
}

export async function discardHostMergeBlockers(repoRoot: string): Promise<void> {
  await discardDirtyPaths(repoRoot, HOST_MERGE_BLOCKER_PATHS);
}

/** Drop ephemeral host churn (lockfile, local orchestrator state) before branch checkout. */
export async function discardHostCheckoutBlockers(
  repoRoot: string,
  sandcastleDir: string,
): Promise<void> {
  await discardDirtyPaths(repoRoot, [
    ...HOST_MERGE_BLOCKER_PATHS,
    completedEpicsStateRelPath(repoRoot, sandcastleDir),
  ]);
}

export async function currentBranchName(): Promise<string | null> {
  const result = await $`git branch --show-current`.quiet().nothrow();
  if (result.exitCode !== 0) {
    return null;
  }
  const name = result.stdout.toString().trim();
  return name.length > 0 ? name : null;
}

export type EnsureIntegrationBranchOptions = {
  /** Skip the log line (for nested calls that reuse a recent ensure). */
  silent?: boolean;
};

export async function ensureIntegrationBranch(
  ctx: EpicContext,
  options: EnsureIntegrationBranchOptions = {},
): Promise<void> {
  const { integrationBranch } = ctx.config;
  const current = await currentBranchName();
  const alreadyOn = current === integrationBranch;

  await $`git fetch origin ${integrationBranch}`.quiet().nothrow();

  if (!alreadyOn) {
    if (!options.silent) {
      console.log(`Ensuring host is on ${integrationBranch}…`);
    }
    const localExists =
      (await $`git rev-parse --verify ${integrationBranch}`.quiet().nothrow()).exitCode === 0;
    if (!localExists) {
      const remoteExists =
        (await $`git rev-parse --verify origin/${integrationBranch}`.quiet().nothrow()).exitCode ===
        0;
      if (remoteExists) {
        await $`git checkout -b ${integrationBranch} origin/${integrationBranch}`.quiet().nothrow();
      } else {
        throw new Error(
          `Integration branch ${integrationBranch} not found locally or on origin. ` +
            `Create it from main before running Sandcastle.`,
        );
      }
    } else {
      const checkout = await $`git checkout ${integrationBranch}`.quiet().nothrow();
      if (checkout.exitCode !== 0) {
        throw new Error(
          `Failed to checkout ${integrationBranch}: ${checkout.stderr.toString().trim()}`,
        );
      }
    }
  }

  await $`git pull origin ${integrationBranch}`.quiet().nothrow();
}

export async function ensureIssueBranches(ctx: EpicContext, issues: PlannedIssue[]): Promise<void> {
  const missing: PlannedIssue[] = [];
  for (const issue of issues) {
    const exists =
      (await $`git rev-parse --verify ${issue.branch}`.quiet().nothrow()).exitCode === 0;
    if (!exists) {
      missing.push(issue);
    }
  }
  if (missing.length === 0) {
    return;
  }
  await ensureIntegrationBranch(ctx, { silent: true });
  for (const issue of missing) {
    await $`git branch ${issue.branch} ${ctx.config.integrationBranch}`;
  }
}

/**
 * @deprecated Prefer {@link listEpicPendingMergeIssues} — this scans every local
 * `feature/*` branch and ignores epic backlog scope.
 */
export async function listAllLocalPendingFeatureBranches(
  ctx: EpicContext,
): Promise<PlannedIssue[]> {
  const pending: PlannedIssue[] = [];

  for (const branch of await listFeatureBranchNames()) {
    const ahead = await countCommitsAhead(ctx, branch);
    if (ahead === 0) {
      continue;
    }
    const issueId = parseFeatureBranchIssueId(branch);
    if (!issueId) {
      continue;
    }
    pending.push({
      id: issueId,
      title: `[pending merge] ${branch}`,
      branch,
    });
  }

  return pending.sort((left, right) => Number(left.id) - Number(right.id));
}

export async function isFastForwardMerge(ctx: EpicContext, branch: string): Promise<boolean> {
  const result = await $`git merge-base --is-ancestor ${ctx.config.integrationBranch} ${branch}`
    .quiet()
    .nothrow();
  return result.exitCode === 0;
}

export function parseFeatureBranchIssueId(branch: string): string | null {
  const match = branch.match(/^feature\/(\d+)-/);
  return match?.[1] ?? null;
}

export async function listFeatureBranchNames(): Promise<readonly string[]> {
  const proc = Bun.spawn({
    cmd: ["git", "for-each-ref", "refs/heads/feature/", "--format=%(refname:short)"],
    stdout: "pipe",
    stderr: "ignore",
  });
  const stdout = await new Response(proc.stdout).text();
  await proc.exited;
  return stdout.trim().split("\n").filter(Boolean);
}

export async function featureBranchForIssue(issueId: string): Promise<string | null> {
  const prefix = `feature/${issueId}-`;
  for (const branch of await listFeatureBranchNames()) {
    if (branch.startsWith(prefix)) {
      return branch;
    }
  }
  return null;
}

/** Whether the integration branch history references this issue (e.g. fixes #20). */
export async function integrationMentionsIssue(
  ctx: EpicContext,
  issueId: string,
): Promise<boolean> {
  const { integrationBranch } = ctx.config;
  const patterns = [`fixes #${issueId}`, `fix #${issueId}`];

  for (const pattern of patterns) {
    const result = await $`git log ${integrationBranch} --oneline --grep=${pattern}`
      .quiet()
      .nothrow();
    if (result.exitCode !== 0) {
      continue;
    }
    if (result.stdout.toString().trim().length > 0) {
      return true;
    }
  }

  return false;
}

export async function closeMergedIssue(ctx: EpicContext, issue: PlannedIssue): Promise<void> {
  await closeIntegratedIssue(
    ctx,
    issue.id,
    `Merged into ${ctx.config.integrationBranch} by Sandcastle.`,
  );
}

export async function closeIntegratedIssue(
  ctx: EpicContext,
  issueId: string,
  comment: string,
): Promise<void> {
  await $`gh issue close ${issueId} --comment ${comment}`.quiet().nothrow();
  const branch = await featureBranchForIssue(issueId);
  if (branch) {
    clearBranchProgress(ctx.config.sandcastleDir, branch);
  }
}

export async function mergeIssueBranchesOnHost(
  ctx: EpicContext,
  issues: PlannedIssue[],
): Promise<void> {
  if (issues.length === 0) {
    return;
  }

  await ensureIntegrationBranch(ctx, { silent: true });
  await discardHostMergeBlockers(ctx.config.repoRoot);

  for (const issue of issues) {
    if ((await countCommitsAhead(ctx, issue.branch)) === 0) {
      continue;
    }

    console.log(`  Host merge ${issue.branch} → ${ctx.config.integrationBranch}…`);
    const result = await $`git merge ${issue.branch} --no-edit`.quiet().nothrow();
    if (result.exitCode !== 0) {
      await $`git merge --abort`.quiet().nothrow();
      const detail = result.stderr.toString().trim();
      throw new Error(`Host merge failed for ${issue.branch}${detail ? `: ${detail}` : ""}`);
    }

    await closeMergedIssue(ctx, issue);
    clearBranchProgress(ctx.config.sandcastleDir, issue.branch);
  }
}
