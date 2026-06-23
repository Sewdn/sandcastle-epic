import * as sandcastle from "@ai-hero/sandcastle";
import type { EpicContext } from "../context.js";
import { agentRunConfig } from "../agent-run.js";
import { agentForRole } from "../agent-provider.js";
import {
  clustersFromIssues,
  logClusterValidationIssues,
  parseClusterOutput,
  validateClusters,
} from "../cluster/helpers.js";
import { filterAlreadyIntegratedIssues, reconcileMergedOpenIssues } from "../reconcile.js";
import { buildEpicBrief, filterClustersToIssues, flattenClusters } from "../planning.js";
import { sandboxRunBase } from "../sandbox.js";
import { epicPlanSchema, type IssueCluster } from "../types.js";
import { skillsPromptArgs } from "../skills.js";

function logHostAnalysis(brief: Awaited<ReturnType<typeof buildEpicBrief>>): void {
  console.log("\nHost epic brief:");
  console.log(`  Integration tip: ${brief.integrationTip ?? "(unknown)"}`);
  console.log(
    `  Open: ${brief.openIssues.length}, integrated: ${brief.integratedIssueIds.length}, pending merge: ${brief.pendingMerge.length}`,
  );
  if (brief.hostAnalysis.unblockedIssues.length > 0) {
    console.log(
      `  Host-unblocked: ${brief.hostAnalysis.unblockedIssues.map((i) => `#${i.id}`).join(", ")}`,
    );
  }
  if (brief.hostAnalysis.blockedIssues.length > 0) {
    for (const blocked of brief.hostAnalysis.blockedIssues) {
      console.log(`  Blocked #${blocked.id} by ${blocked.openBlockerIds.join(", ")}`);
    }
  }
}

async function finalizeClusters(
  ctx: EpicContext,
  clusters: readonly IssueCluster[],
): Promise<IssueCluster[]> {
  const planned = flattenClusters(clusters);
  const filtered = await filterAlreadyIntegratedIssues(ctx, planned);
  if (filtered.length === 0) {
    return [];
  }

  const validated = validateClusters(filtered, clusters);
  if (validated) {
    return validated;
  }

  return filterClustersToIssues(clusters, filtered);
}

function fallbackClusters(brief: Awaited<ReturnType<typeof buildEpicBrief>>): IssueCluster[] {
  if (brief.hostAnalysis.suggestedClusters.length > 0) {
    console.warn("Planner output invalid — using host suggested clusters.");
    return [...brief.hostAnalysis.suggestedClusters];
  }

  return clustersFromIssues(brief.hostAnalysis.unblockedIssues);
}

/** Unified planner: host brief + agent review of dependencies, clustering, and ordering. */
export async function runEpicPlanner(ctx: EpicContext): Promise<IssueCluster[]> {
  console.log("\nReconciling open issues already on the integration branch…");
  await reconcileMergedOpenIssues(ctx);

  const brief = await buildEpicBrief(ctx);
  logHostAnalysis(brief);

  if (brief.openIssues.length === 0) {
    console.log("No open ready-for-agent issues remain for this epic.");
    return [];
  }

  if (brief.hostAnalysis.unblockedIssues.length === 0 && brief.pendingMerge.length > 0) {
    console.log("All open issues blocked or waiting on pending merges — skipping planner agent.");
    return [];
  }

  try {
    const plan = await sandcastle.run({
      ...sandboxRunBase(ctx),
      ...agentRunConfig(ctx, {
        role: "planner",
        branch: ctx.config.integrationBranch,
        name: "planner",
      }),
      maxIterations: 1,
      agent: agentForRole(ctx, "planner"),
      promptFile: ctx.promptFile("plan"),
      promptArgs: {
        ...ctx.sharedPromptArgs,
        ...(await skillsPromptArgs(ctx, "planner")),
        EPIC_BRIEF: JSON.stringify(brief, null, 2),
      },
      output: sandcastle.Output.object({ tag: "plan", schema: epicPlanSchema }),
    });

    const finalized = await finalizeClusters(ctx, plan.output.clusters);
    if (finalized.length > 0) {
      return finalized;
    }

    console.warn("Planner returned no actionable clusters after integration filtering.");
  } catch (error) {
    if (error instanceof sandcastle.StructuredOutputError) {
      console.warn(`Planner structured output failed: ${error.message}`);
      logClusterValidationIssues(error.cause);

      if (error.rawMatched) {
        const parsed = parseClusterOutput(error.rawMatched);
        if (parsed) {
          const finalized = await finalizeClusters(ctx, parsed);
          if (finalized.length > 0) {
            console.warn("Recovered cluster plan from raw planner output.");
            return finalized;
          }
        }
      }
    } else {
      throw error;
    }
  }

  return fallbackClusters(brief);
}

/** @deprecated Use {@link runEpicPlanner} — returns flat unblocked issues from host brief only. */
export async function runDependencyPlanner(ctx: EpicContext) {
  const brief = await buildEpicBrief(ctx);
  return brief.hostAnalysis.unblockedIssues;
}
