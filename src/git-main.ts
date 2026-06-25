import { $ } from "bun";
import { integrationBranchForEpic } from "./epics.js";
import { discardHostCheckoutBlockers } from "./git.js";

export type LongRunHandoffOptions = {
  readonly pushRemotes: boolean;
  readonly repoRoot: string;
  readonly sandcastleDir: string;
};

export type MergeToMainOptions = LongRunHandoffOptions & {
  readonly mainBranch: string;
};

export type IntegrationBranchSyncStep = {
  readonly targetBranch: string;
  readonly sourceBranch: string;
};

export type SyncIntegrationBranchChainOptions = {
  readonly epics: readonly string[];
  readonly mainBranch: string;
  readonly pushRemotes: boolean;
  readonly dryRun: boolean;
};

export type SyncIntegrationBranchChainResult = {
  readonly steps: readonly IntegrationBranchSyncStep[];
  readonly mergedSteps: readonly IntegrationBranchSyncStep[];
  readonly skippedSteps: readonly IntegrationBranchSyncStep[];
  readonly finalBranch: string | null;
};

async function countCommitsAhead(base: string, branch: string): Promise<number> {
  const branchExists = (await $`git rev-parse --verify ${branch}`.quiet().nothrow()).exitCode === 0;
  if (!branchExists) {
    return 0;
  }
  const countResult = await $`git rev-list --count ${base}..${branch}`.quiet().nothrow();
  if (countResult.exitCode !== 0) {
    return 0;
  }
  const count = Number(countResult.stdout.toString().trim());
  return Number.isFinite(count) ? count : 0;
}

export async function ensureMainBranch(mainBranch: string): Promise<void> {
  console.log(`Ensuring host is on ${mainBranch}…`);
  await $`git fetch origin ${mainBranch}`.quiet().nothrow();
  const localExists =
    (await $`git rev-parse --verify ${mainBranch}`.quiet().nothrow()).exitCode === 0;
  if (!localExists) {
    const remoteExists =
      (await $`git rev-parse --verify origin/${mainBranch}`.quiet().nothrow()).exitCode === 0;
    if (remoteExists) {
      await $`git checkout -b ${mainBranch} origin/${mainBranch}`;
    } else {
      throw new Error(`Main branch ${mainBranch} not found locally or on origin.`);
    }
  } else {
    await $`git checkout ${mainBranch}`;
  }
  await $`git pull origin ${mainBranch}`.quiet().nothrow();
}

export async function pushBranch(branch: string): Promise<void> {
  console.log(`  Pushing ${branch} to origin…`);
  const result = await $`git push origin ${branch}`.quiet().nothrow();
  if (result.exitCode !== 0) {
    console.warn(`  Push failed for ${branch} (continuing).`);
  }
}

export async function pushIntegrationBranchIfEnabled(
  integrationBranch: string,
  options: LongRunHandoffOptions,
  reason?: string,
): Promise<void> {
  if (!options.pushRemotes) {
    return;
  }

  if (reason) {
    console.log(reason);
  }
  await pushBranch(integrationBranch);
}

/** Merge a completed epic integration branch into main on the host (manual maintainer step). */
export async function mergeIntegrationBranchIntoMain(
  integrationBranch: string,
  options: MergeToMainOptions,
): Promise<void> {
  const ahead = await countCommitsAhead(options.mainBranch, integrationBranch);
  if (ahead === 0) {
    console.log(
      `  ${integrationBranch} has no commits ahead of ${options.mainBranch} — skip merge.`,
    );
    return;
  }

  await ensureMainBranch(options.mainBranch);

  console.log(`  Merging ${integrationBranch} → ${options.mainBranch} (${ahead} commit(s))…`);
  const result = await $`git merge ${integrationBranch} --no-edit`.quiet().nothrow();
  if (result.exitCode !== 0) {
    await $`git merge --abort`.quiet().nothrow();
    throw new Error(
      `Failed to merge ${integrationBranch} into ${options.mainBranch}. Resolve conflicts manually.`,
    );
  }

  if (options.pushRemotes) {
    await pushBranch(options.mainBranch);
  }
}

/**
 * Create or refresh an epic integration branch from main.
 * Use when starting a single epic from current main — not for long-run handoff.
 */
export async function bootstrapIntegrationBranchFromMain(
  epic: string,
  options: MergeToMainOptions,
): Promise<string> {
  const integrationBranch = integrationBranchForEpic(epic);
  await discardHostCheckoutBlockers(options.repoRoot, options.sandcastleDir);
  await ensureMainBranch(options.mainBranch);

  const exists =
    (await $`git rev-parse --verify ${integrationBranch}`.quiet().nothrow()).exitCode === 0;

  if (!exists) {
    console.log(`  Creating ${integrationBranch} from ${options.mainBranch}…`);
    await $`git checkout -b ${integrationBranch} ${options.mainBranch}`;
  } else {
    console.log(`  Refreshing existing ${integrationBranch} from ${options.mainBranch}…`);
    await $`git checkout ${integrationBranch}`;
    const ff = await $`git merge ${options.mainBranch} --ff-only`.quiet().nothrow();
    if (ff.exitCode !== 0) {
      throw new Error(
        `${integrationBranch} exists but is not a fast-forward from ${options.mainBranch}. ` +
          `Reconcile manually before long-run orchestration.`,
      );
    }
  }

  if (options.pushRemotes) {
    await pushIntegrationBranchIfEnabled(integrationBranch, options);
  }

  return integrationBranch;
}

/**
 * Create or refresh the next epic integration branch from the previous epic's branch.
 * Long-run handoff: work accumulates on the chain; merge to main is manual after review.
 */
export async function bootstrapIntegrationBranchFromEpic(
  previousEpic: string,
  nextEpic: string,
  options: LongRunHandoffOptions,
): Promise<string> {
  const previousBranch = integrationBranchForEpic(previousEpic);
  const nextBranch = integrationBranchForEpic(nextEpic);

  await discardHostCheckoutBlockers(options.repoRoot, options.sandcastleDir);

  const nextExists =
    (await $`git rev-parse --verify ${nextBranch}`.quiet().nothrow()).exitCode === 0;
  const previousExists =
    (await $`git rev-parse --verify ${previousBranch}`.quiet().nothrow()).exitCode === 0;
  if (!previousExists) {
    if (nextExists) {
      console.log(
        `  Previous ${previousBranch} was cleaned up; using existing ${nextBranch} as handoff target…`,
      );
      await $`git checkout ${nextBranch}`;
      if (options.pushRemotes) {
        await pushIntegrationBranchIfEnabled(nextBranch, options);
      }
      return nextBranch;
    }

    throw new Error(
      `Previous integration branch ${previousBranch} not found. Complete epic ${previousEpic} first.`,
    );
  }

  await $`git checkout ${previousBranch}`;

  if (!nextExists) {
    console.log(`  Creating ${nextBranch} from ${previousBranch}…`);
    await $`git checkout -b ${nextBranch} ${previousBranch}`;
  } else {
    console.log(`  Refreshing existing ${nextBranch} from ${previousBranch}…`);
    await $`git checkout ${nextBranch}`;
    const ff = await $`git merge ${previousBranch} --ff-only`.quiet().nothrow();
    if (ff.exitCode !== 0) {
      throw new Error(
        `${nextBranch} exists but is not a fast-forward from ${previousBranch}. ` +
          `Reconcile manually before long-run orchestration.`,
      );
    }
  }

  if (options.pushRemotes) {
    await pushIntegrationBranchIfEnabled(nextBranch, options);
  }

  return nextBranch;
}

/** Ordered merge steps to restore main → first epic → … → last epic integration branches. */
export function buildIntegrationBranchSyncSteps(
  epics: readonly string[],
  mainBranch: string,
): IntegrationBranchSyncStep[] {
  if (epics.length === 0) {
    return [];
  }

  const steps: IntegrationBranchSyncStep[] = [
    {
      targetBranch: integrationBranchForEpic(epics[0]!),
      sourceBranch: mainBranch,
    },
  ];

  for (let index = 1; index < epics.length; index++) {
    steps.push({
      targetBranch: integrationBranchForEpic(epics[index]!),
      sourceBranch: integrationBranchForEpic(epics[index - 1]!),
    });
  }

  return steps;
}

export async function integrationBranchExists(branch: string): Promise<boolean> {
  return (await $`git rev-parse --verify ${branch}`.quiet().nothrow()).exitCode === 0;
}

async function mergeSourceIntoTarget(
  targetBranch: string,
  sourceBranch: string,
): Promise<"merged" | "skipped"> {
  const ahead = await countCommitsAhead(targetBranch, sourceBranch);
  if (ahead === 0) {
    console.log(`  ${targetBranch} already contains ${sourceBranch} — skip merge.`);
    return "skipped";
  }

  await $`git checkout ${targetBranch}`;
  console.log(`  Merging ${sourceBranch} → ${targetBranch} (${ahead} commit(s))…`);
  const result = await $`git merge ${sourceBranch} --no-edit`.quiet().nothrow();
  if (result.exitCode !== 0) {
    await $`git merge --abort`.quiet().nothrow();
    throw new Error(
      `Failed to merge ${sourceBranch} into ${targetBranch}. Resolve conflicts manually on ${targetBranch}.`,
    );
  }

  return "merged";
}

/**
 * Merge main into the first integration branch, then merge each integration branch into the next
 * until the full epic chain is restored.
 */
export async function syncIntegrationBranchChain(
  options: SyncIntegrationBranchChainOptions,
): Promise<SyncIntegrationBranchChainResult> {
  const steps = buildIntegrationBranchSyncSteps(options.epics, options.mainBranch);
  if (steps.length === 0) {
    throw new Error("Epic list is empty. Provide at least one epic slug.");
  }

  const mergedSteps: IntegrationBranchSyncStep[] = [];
  const skippedSteps: IntegrationBranchSyncStep[] = [];

  console.log(
    `Sync integration branch chain (${options.dryRun ? "dry run" : "apply"}): ${[
      options.mainBranch,
      ...steps.map((step) => step.targetBranch),
    ].join(" → ")}`,
  );

  if (options.dryRun) {
    for (const step of steps) {
      if (!(await integrationBranchExists(step.targetBranch))) {
        throw new Error(
          `Integration branch ${step.targetBranch} not found. Create it before syncing the chain.`,
        );
      }
      console.log(`  [dry run] merge ${step.sourceBranch} → ${step.targetBranch}`);
    }

    return {
      steps,
      mergedSteps,
      skippedSteps,
      finalBranch: steps[steps.length - 1]?.targetBranch ?? null,
    };
  }

  await ensureMainBranch(options.mainBranch);

  for (const step of steps) {
    if (!(await integrationBranchExists(step.targetBranch))) {
      throw new Error(
        `Integration branch ${step.targetBranch} not found. Create it before syncing the chain.`,
      );
    }

    if (step === steps[0] && !(await integrationBranchExists(step.sourceBranch))) {
      throw new Error(`Main branch ${step.sourceBranch} not found locally or on origin.`);
    }

    if (step !== steps[0] && !(await integrationBranchExists(step.sourceBranch))) {
      throw new Error(
        `Source branch ${step.sourceBranch} not found. Complete prior epic sync steps first.`,
      );
    }

    const outcome = await mergeSourceIntoTarget(step.targetBranch, step.sourceBranch);
    if (outcome === "merged") {
      mergedSteps.push(step);
      if (options.pushRemotes) {
        await pushBranch(step.targetBranch);
      }
    } else {
      skippedSteps.push(step);
    }
  }

  const finalBranch = steps[steps.length - 1]?.targetBranch ?? null;
  if (finalBranch) {
    await $`git checkout ${finalBranch}`;
  }

  console.log("\nIntegration branch chain sync complete.");
  console.log(
    `  Merged: ${mergedSteps.length}, skipped (already up to date): ${skippedSteps.length}`,
  );
  if (finalBranch) {
    console.log(`  Chain tip: ${finalBranch}`);
  }

  return {
    steps,
    mergedSteps,
    skippedSteps,
    finalBranch,
  };
}
