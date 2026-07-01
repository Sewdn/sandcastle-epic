import { $ } from "bun";
import { mergeIntegrationBranchWithAgent } from "./agents/merger.js";
import type { EpicContext } from "./context.js";
import { integrationBranchForEpic } from "./epics.js";
import { countCommitsAheadOf, discardHostCheckoutBlockers } from "./git.js";
import { pushIntegrationBranchIfEnabled, type LongRunHandoffOptions } from "./git-main.js";
import type { EpicWorkOrder } from "./epic-work-order.js";

export type IntegrationHandoffStep = {
  readonly targetEpic: string;
  readonly sourceEpic: string;
  readonly targetBranch: string;
  readonly sourceBranch: string;
};

async function branchExists(branch: string): Promise<boolean> {
  return (await $`git rev-parse --verify ${branch}`.quiet().nothrow()).exitCode === 0;
}

async function isFastForwardMergeIntoTarget(target: string, source: string): Promise<boolean> {
  const result = await $`git merge-base --is-ancestor ${target} ${source}`.quiet().nothrow();
  return result.exitCode === 0;
}

/** Ordered merges of dependency epic integration branches into a target epic branch. */
export function buildDependencyIntegrationMergeSteps(
  targetEpic: string,
  dependsOnEpics: readonly string[],
): IntegrationHandoffStep[] {
  return dependsOnEpics.map((sourceEpic) => ({
    targetEpic,
    sourceEpic,
    targetBranch: integrationBranchForEpic(targetEpic),
    sourceBranch: integrationBranchForEpic(sourceEpic),
  }));
}

export function dependsOnEpicsForEpic(
  workOrder: EpicWorkOrder,
  epic: string,
): readonly string[] {
  return workOrder.entries.find((entry) => entry.epic === epic)?.dependsOnEpics ?? [];
}

async function mergeIntegrationBranchOnHost(
  targetBranch: string,
  sourceBranch: string,
): Promise<"merged" | "skipped"> {
  const ahead = await countCommitsAheadOf(targetBranch, sourceBranch);
  if (ahead === 0) {
    console.log(`  ${targetBranch} already contains ${sourceBranch} — skip merge.`);
    return "skipped";
  }

  await $`git checkout ${targetBranch}`;
  console.log(`  Fast-forward merge on host: ${sourceBranch} → ${targetBranch} (${ahead} commit(s))…`);
  const result = await $`git merge ${sourceBranch} --ff-only`.quiet().nothrow();
  if (result.exitCode !== 0) {
    await $`git merge --abort`.quiet().nothrow();
    throw new Error(`Host fast-forward merge failed for ${sourceBranch} → ${targetBranch}.`);
  }

  return "merged";
}

/**
 * Merge each dependency epic's integration branch into the current epic branch.
 * Host fast-forward when possible; merger agent when histories diverged.
 */
export async function mergeDependencyIntegrationBranches(
  ctx: EpicContext,
  dependsOnEpics: readonly string[],
  options: LongRunHandoffOptions,
): Promise<void> {
  const steps = buildDependencyIntegrationMergeSteps(ctx.config.epic, dependsOnEpics);
  if (steps.length === 0) {
    return;
  }

  await discardHostCheckoutBlockers(options.repoRoot, options.sandcastleDir);
  await $`git checkout ${ctx.config.integrationBranch}`;

  for (const step of steps) {
    if (!(await branchExists(step.sourceBranch))) {
      console.log(
        `  Dependency ${step.sourceBranch} not found (likely merged to main); skipping cross-epic merge.`,
      );
      continue;
    }

    const ahead = await countCommitsAheadOf(step.targetBranch, step.sourceBranch);
    if (ahead === 0) {
      console.log(`  ${step.targetBranch} already contains ${step.sourceBranch} — skip.`);
      continue;
    }

    console.log(
      `  Cross-epic handoff: ${step.sourceBranch} → ${step.targetBranch} (${ahead} commit(s))…`,
    );

    if (await isFastForwardMergeIntoTarget(step.targetBranch, step.sourceBranch)) {
      await mergeIntegrationBranchOnHost(step.targetBranch, step.sourceBranch);
    } else {
      console.log(`  Non-fast-forward — merger agent for ${step.sourceBranch}…`);
      await mergeIntegrationBranchWithAgent(ctx, step.sourceBranch, step.sourceEpic);
    }

    if (options.pushRemotes) {
      await pushIntegrationBranchIfEnabled(
        step.targetBranch,
        options,
        `  Pushing ${step.targetBranch} after dependency merge…`,
      );
    }
  }
}
