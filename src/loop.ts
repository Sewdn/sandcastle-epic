import type { EpicContext } from "./context.js";
import { ensureDockerRuntime } from "./docker.js";
import { ensureIntegrationBranch, listPendingMergeIssues } from "./git.js";
import { implementCluster } from "./agents/implement.js";
import { runEpicPlanner } from "./agents/planner.js";
import { clusterLabel } from "./cluster/helpers.js";
import { processPendingMergeGate } from "./merge.js";
import { runSandcastlePreflight } from "./preflight.js";
import type { EpicLoopResult } from "./types.js";

export async function runEpicLoop(ctx: EpicContext): Promise<EpicLoopResult> {
  await ensureDockerRuntime(ctx);
  await ensureIntegrationBranch(ctx);
  await runSandcastlePreflight(ctx);

  for (let iteration = 1; iteration <= ctx.config.maxIterations; iteration++) {
    console.log(
      `\n=== Iteration ${iteration}/${ctx.config.maxIterations} (${ctx.config.epicLabel}) ===\n`,
    );

    await ensureDockerRuntime(ctx);

    const gateBlocked = await processPendingMergeGate(ctx);
    const stillPending = await listPendingMergeIssues(ctx);
    if (stillPending.length > 0) {
      console.log(
        `${stillPending.length} branch(es) still unmerged — retry next iteration before planning new work.`,
      );
      continue;
    }

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

    for (const [index, cluster] of clusters.entries()) {
      console.log(`\n--- Cluster run ${index + 1}/${clusters.length} ---`);
      try {
        await implementCluster(ctx, cluster);
      } catch (error) {
        const branches = cluster.issues.map((i) => i.branch).join(", ");
        console.error(`  ✗ Cluster [${clusterLabel(cluster)}] (${branches}) failed: ${error}`);
      }
    }
  }

  const pendingAfter = await listPendingMergeIssues(ctx);
  if (pendingAfter.length > 0) {
    console.log(
      `\nEpic ${ctx.config.epicLabel} stopped: ${pendingAfter.length} branch(es) still unmerged after ${ctx.config.maxIterations} iterations.`,
    );
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
