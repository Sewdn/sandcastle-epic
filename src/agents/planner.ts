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
import {
  printEpicPlanReport,
  printHostPlannerBaselineReport,
  type EpicPlanSource,
} from "../planner-report.js";
import {
  buildEpicBrief,
  filterClustersToEpic,
  filterClustersToIssues,
  flattenClusters,
} from "../planning.js";
import { sandboxRunBase } from "../sandbox.js";
import { epicPlanSchema, type IssueCluster } from "../types.js";
import { skillsPromptArgs } from "../skills.js";

async function finalizeClusters(
  ctx: EpicContext,
  clusters: readonly IssueCluster[],
  brief: Awaited<ReturnType<typeof buildEpicBrief>>,
): Promise<IssueCluster[]> {
  const planned = flattenClusters(clusters);
  const filtered = await filterAlreadyIntegratedIssues(ctx, planned);
  if (filtered.length === 0) {
    return [];
  }

  const validated = validateClusters(filtered, clusters);
  const resolved = validated ?? filterClustersToIssues(clusters, filtered);
  return filterClustersToEpic(resolved, ctx.config.epic, brief);
}

function fallbackClusters(
  brief: Awaited<ReturnType<typeof buildEpicBrief>>,
): { readonly clusters: IssueCluster[]; readonly source: EpicPlanSource } {
  if (brief.hostAnalysis.suggestedClusters.length > 0) {
    console.warn("Planner output invalid — using host suggested clusters.");
    return { clusters: [...brief.hostAnalysis.suggestedClusters], source: "host-suggested" };
  }

  return {
    clusters: clustersFromIssues(brief.hostAnalysis.unblockedForCurrentEpic),
    source: "host-fallback",
  };
}

function publishPlan(
  clusters: readonly IssueCluster[],
  brief: Awaited<ReturnType<typeof buildEpicBrief>>,
  source: EpicPlanSource,
): IssueCluster[] {
  printEpicPlanReport(clusters, { epicLabel: brief.epicLabel, source });
  return [...clusters];
}

/** Unified planner: host brief + agent review of dependencies, clustering, and ordering. */
export async function runEpicPlanner(ctx: EpicContext): Promise<IssueCluster[]> {
  console.log("\nReconciling open issues already on the integration branch…");
  await reconcileMergedOpenIssues(ctx);

  const brief = await buildEpicBrief(ctx);
  printHostPlannerBaselineReport(brief, ctx.projectMap);

  const currentEpicOpen = brief.openIssues.filter((issue) => issue.epic === brief.epic);
  if (currentEpicOpen.length === 0) {
    console.log("No open ready-for-agent issues remain for this epic.");
    printEpicPlanReport([], { epicLabel: brief.epicLabel, source: "host-fallback" });
    return [];
  }

  if (brief.hostAnalysis.unblockedForCurrentEpic.length === 0 && brief.pendingMerge.length > 0) {
    console.log("All open issues blocked or waiting on pending merges — skipping planner agent.");
    printEpicPlanReport([], { epicLabel: brief.epicLabel, source: "host-fallback" });
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
        PROJECT_MAP: JSON.stringify(ctx.projectMap, null, 2),
      },
      output: sandcastle.Output.object({ tag: "plan", schema: epicPlanSchema }),
    });

    const finalized = await finalizeClusters(ctx, plan.output.clusters, brief);
    if (finalized.length > 0) {
      return publishPlan(finalized, brief, "planner-agent");
    }

    console.warn("Planner returned no actionable clusters after integration filtering.");
  } catch (error) {
    if (error instanceof sandcastle.StructuredOutputError) {
      console.warn(`Planner structured output failed: ${error.message}`);
      logClusterValidationIssues(error.cause);

      if (error.rawMatched) {
        const parsed = parseClusterOutput(error.rawMatched);
        if (parsed) {
          const finalized = await finalizeClusters(ctx, parsed, brief);
          if (finalized.length > 0) {
            console.warn("Recovered cluster plan from raw planner output.");
            return publishPlan(finalized, brief, "planner-agent");
          }
        }
      }
    } else {
      throw error;
    }
  }

  const fallback = fallbackClusters(brief);
  return publishPlan(fallback.clusters, brief, fallback.source);
}

/** @deprecated Use {@link runEpicPlanner} — returns flat unblocked issues from host brief only. */
export async function runDependencyPlanner(ctx: EpicContext) {
  const brief = await buildEpicBrief(ctx);
  return brief.hostAnalysis.unblockedForCurrentEpic;
}
