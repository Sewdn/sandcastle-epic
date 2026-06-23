import type { EpicContext } from "./context.js";
import { resolveStalledBranches } from "./agents/resolver.js";
import { mergeIssueBranchesWithAgent } from "./agents/merger.js";
import { reviewIssues } from "./agents/review.js";
import { reconcileHostDependencies } from "./deps.js";
import {
  countCommitsAhead,
  ensureIntegrationBranch,
  isFastForwardMerge,
  issuesWithCommits,
  listPendingMergeIssues,
  mergeIssueBranchesOnHost,
} from "./git.js";
import type { PlannedIssue } from "./types.js";
import { releaseSandcastleWorktrees } from "./worktrees.js";

export async function mergeIssueBranches(ctx: EpicContext, issues: PlannedIssue[]): Promise<void> {
  if (issues.length === 0) {
    return;
  }

  await ensureIntegrationBranch(ctx, { silent: true });

  const pending = await issuesWithCommits(ctx, issues);
  if (pending.length === 0) {
    return;
  }

  // Classify and merge one branch at a time — integration moves after each merge,
  // so batch FF classification is wrong for ordered cluster branches (#18 then #20).
  for (const issue of pending) {
    if ((await countCommitsAhead(ctx, issue.branch)) === 0) {
      continue;
    }

    if (await isFastForwardMerge(ctx, issue.branch)) {
      console.log(`  Fast-forward merge on host (no agent): ${issue.branch}…`);
      await mergeIssueBranchesOnHost(ctx, [issue]);
    } else {
      console.log(`  Agent merge: ${issue.branch}…`);
      await mergeIssueBranchesWithAgent(ctx, [issue]);
    }
  }
}

async function tryMergePending(
  ctx: EpicContext,
  pending: PlannedIssue[],
  label: string,
): Promise<boolean> {
  const withCommits = await issuesWithCommits(ctx, pending);
  if (withCommits.length === 0) {
    return false;
  }

  console.log(`\n${label}`);
  try {
    await mergeIssueBranches(ctx, withCommits);
    await reconcileHostDependencies(ctx.config.repoRoot);
  } catch (error) {
    console.error(`  Merge failed: ${error}`);
    return false;
  }

  const stillPending = await listPendingMergeIssues(ctx);
  return stillPending.length === 0;
}

/** Review and merge completed feature branches before planning new work. */
export async function processPendingMergeGate(ctx: EpicContext): Promise<boolean> {
  const pending = await listPendingMergeIssues(ctx);
  if (pending.length === 0) {
    return false;
  }

  console.log("\nReleasing Sandcastle worktrees before host merge…");
  await releaseSandcastleWorktrees(ctx);

  console.log(
    `\nPending merge gate — ${pending.length} branch(es) must land in ${ctx.config.integrationBranch} before new work:`,
  );
  for (const issue of pending) {
    console.log(`  #${issue.id}: ${issue.branch}`);
  }

  if (
    await tryMergePending(
      ctx,
      pending,
      "Attempting host merge without re-review (branches may already be reviewed)…",
    )
  ) {
    console.log("Pending merge gate complete.");
    return true;
  }

  const ready = await reviewIssues(ctx, pending);

  if (ready.length === 0) {
    const withCommits = await issuesWithCommits(ctx, pending);
    if (withCommits.length > 0) {
      console.log("Review produced no merge-ready branches — running resolver…");
      await resolveStalledBranches(
        ctx,
        withCommits,
        "Review failed or timed out with unmerged commits still on feature branch(es).",
      ).catch((error) => {
        console.error(`  Resolver failed: ${error}`);
      });
    } else {
      console.log("No pending branches reviewed successfully. Skipping planner this iteration.");
      return true;
    }
  }

  if (
    await tryMergePending(
      ctx,
      pending,
      `Merging ${ready.length > 0 ? ready.length : pending.length} pending branch(es) into ${ctx.config.integrationBranch}…`,
    )
  ) {
    console.log("Pending merge gate complete.");
    return true;
  }

  const stillPending = await listPendingMergeIssues(ctx);
  if (stillPending.length > 0) {
    console.log("Merge still blocked — running resolver before next iteration…");
    await resolveStalledBranches(
      ctx,
      stillPending,
      "Host merge failed after review; reconcile branch state for merge into the integration branch.",
    ).catch((error) => {
      console.error(`  Resolver failed: ${error}`);
    });
  }

  return true;
}
