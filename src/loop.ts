import type { EpicContext } from "./context.js";
import { ensureDockerRuntime } from "./docker.js";
import { ensureIntegrationBranch } from "./git.js";
import { listEpicPendingMergeIssues } from "./planning.js";
import { implementCluster } from "./agents/implement.js";
import { runEpicPlanner } from "./agents/planner.js";
import { clusterLabel } from "./cluster/helpers.js";
import { processPendingMergeGate } from "./merge.js";
import { runSandcastlePreflight } from "./preflight.js";
import { maybeIntervene, recentSandcastleLogPaths } from "./intervention.js";
import { mapWithConcurrency, resolveParallelClusterConfig } from "./parallel.js";
import type { EpicLoopResult, IssueCluster } from "./types.js";

async function handleClusterFailure(
  ctx: EpicContext,
  cluster: IssueCluster,
  error: unknown,
  mode: "parallel" | "sequential",
): Promise<void> {
  const branches = cluster.issues.map((i) => i.branch).join(", ");
  console.error(`  ✗ Cluster [${clusterLabel(cluster)}] (${branches}) failed: ${error}`);
  await maybeIntervene(ctx, {
    reason: "cluster-implement-failed",
    iteration: 0,
    maxIterations: ctx.config.maxIterations,
    pendingIssues: cluster.issues,
    recentLogPaths: recentSandcastleLogPaths(ctx.config.sandcastleDir),
    detail: `${mode === "parallel" ? "Parallel" : "Sequential"} cluster [${clusterLabel(cluster)}] failed: ${error}`,
  });
}

async function runClusters(ctx: EpicContext, clusters: readonly IssueCluster[]): Promise<void> {
  const parallel = resolveParallelClusterConfig();

  if (parallel.enabled && parallel.limit > 1 && clusters.length > 1) {
    const concurrency = Math.min(parallel.limit, clusters.length);
    console.log(
      `Running ${clusters.length} cluster(s) with concurrency ${concurrency} (limit ${parallel.limit})…`,
    );

    const results = await mapWithConcurrency(clusters, concurrency, async (cluster, index) => {
      console.log(
        `\n--- Cluster run ${index + 1}/${clusters.length} (parallel slot, max ${concurrency}) ---`,
      );
      await implementCluster(ctx, cluster);
    });

    for (const [index, result] of results.entries()) {
      if (result.status === "rejected") {
        await handleClusterFailure(ctx, clusters[index]!, result.reason, "parallel");
      }
    }

    return;
  }

  for (const [index, cluster] of clusters.entries()) {
    console.log(`\n--- Cluster run ${index + 1}/${clusters.length} (sequential) ---`);
    try {
      await implementCluster(ctx, cluster);
    } catch (error) {
      await handleClusterFailure(ctx, cluster, error, "sequential");
    }
  }
}

export async function runEpicLoop(ctx: EpicContext): Promise<EpicLoopResult> {
  await ensureDockerRuntime(ctx);
  await ensureIntegrationBranch(ctx);
  await runSandcastlePreflight(ctx);

  let consecutivePendingIterations = 0;

  for (let iteration = 1; iteration <= ctx.config.maxIterations; iteration++) {
    console.log(
      `\n=== Iteration ${iteration}/${ctx.config.maxIterations} (${ctx.config.epicLabel}) ===\n`,
    );

    await ensureDockerRuntime(ctx);

    const gateBlocked = await processPendingMergeGate(ctx);
    const stillPending = await listEpicPendingMergeIssues(ctx);
    if (stillPending.length > 0) {
      consecutivePendingIterations += 1;
      console.log(
        `${stillPending.length} branch(es) still unmerged — retry next iteration before planning new work.`,
      );

      if (consecutivePendingIterations >= 2) {
        await maybeIntervene(ctx, {
          reason: "pending-merge-stalled",
          iteration,
          maxIterations: ctx.config.maxIterations,
          pendingIssues: stillPending,
          recentLogPaths: recentSandcastleLogPaths(ctx.config.sandcastleDir),
          detail: `${stillPending.length} branch(es) unmerged for ${consecutivePendingIterations} consecutive iteration(s).`,
        });
      }

      if (iteration >= ctx.config.maxIterations - 1) {
        await maybeIntervene(ctx, {
          reason: "max-iterations-approaching",
          iteration,
          maxIterations: ctx.config.maxIterations,
          pendingIssues: stillPending,
          recentLogPaths: recentSandcastleLogPaths(ctx.config.sandcastleDir),
          detail: `Epic loop near maxIterations with ${stillPending.length} pending merge(s).`,
        });
      }

      continue;
    }

    consecutivePendingIterations = 0;

    if (gateBlocked) {
      console.log("Pending work merged — continuing to plan new issues this iteration.");
    }

    const clusters = await runEpicPlanner(ctx);

    if (clusters.length === 0) {
      console.log("No unblocked agent issues to work on. Epic agent queue complete.");
      return { completed: true, reason: "no-agent-work", iterationsRun: iteration };
    }

    const issueCount = clusters.reduce((total, cluster) => total + cluster.issues.length, 0);
    console.log(`Epic plan: ${issueCount} issue(s) in ${clusters.length} implementer run(s):`);
    for (const cluster of clusters) {
      console.log(`  [${clusterLabel(cluster)}]: ${cluster.reason}`);
    }

    await runClusters(ctx, clusters);
  }

  const pendingAfter = await listEpicPendingMergeIssues(ctx);
  if (pendingAfter.length > 0) {
    console.log(
      `\nEpic ${ctx.config.epicLabel} stopped: ${pendingAfter.length} branch(es) still unmerged after ${ctx.config.maxIterations} iterations.`,
    );
    await maybeIntervene(ctx, {
      reason: "pending-merge-stalled",
      iteration: ctx.config.maxIterations,
      maxIterations: ctx.config.maxIterations,
      pendingIssues: pendingAfter,
      recentLogPaths: recentSandcastleLogPaths(ctx.config.sandcastleDir),
      detail: `Epic stopped with ${pendingAfter.length} unmerged branch(es) after maxIterations.`,
    });
    return {
      completed: false,
      reason: "pending-merges",
      iterationsRun: ctx.config.maxIterations,
    };
  }

  console.log(
    `\nEpic ${ctx.config.epicLabel} stopped: reached maxIterations (${ctx.config.maxIterations}) with agent work remaining.`,
  );
  return {
    completed: false,
    reason: "max-iterations",
    iterationsRun: ctx.config.maxIterations,
  };
}

export function printEpicLoopComplete(
  ctx: EpicContext,
  result: EpicLoopResult,
  message: string,
): void {
  console.log("\nAll done.");
  console.log(message);
  if (!result.completed) {
    console.log(
      `  Status: incomplete (${result.reason}) after ${result.iterationsRun} iteration(s).`,
    );
  }
}

export async function runEpicLoopWithMessage(ctx: EpicContext): Promise<EpicLoopResult> {
  const result = await runEpicLoop(ctx);
  printEpicLoopComplete(
    ctx,
    result,
    result.completed
      ? `Epic integration branch ${ctx.config.integrationBranch} is ready for your manual review and PR to main.`
      : `Epic ${ctx.config.epicLabel} needs attention before merging to main.`,
  );
  return result;
}
