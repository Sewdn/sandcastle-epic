import * as sandcastle from "@ai-hero/sandcastle";
import type { EpicContext } from "../context.js";
import { agentRunConfig } from "../agent-run.js";
import { agentForRole } from "../agent-provider.js";
import { sandboxRunBase } from "../sandbox.js";
import { clusterSchema, type IssueCluster, type PlannedIssue } from "../types.js";
import { skillsPromptArgs } from "../skills.js";
import {
  clustersFromIssues,
  logClusterValidationIssues,
  parseClusterOutput,
  validateClusters,
} from "./helpers.js";

/** @deprecated Unified planner replaces this — kept for direct invocation / tests. */
export async function planClusters(
  ctx: EpicContext,
  planned: PlannedIssue[],
): Promise<IssueCluster[]> {
  if (planned.length <= 1) {
    return clustersFromIssues(planned);
  }

  try {
    const cluster = await sandcastle.run({
      ...sandboxRunBase(ctx),
      ...agentRunConfig(ctx, {
        role: "planner",
        branch: ctx.config.integrationBranch,
        name: "cluster-planner",
      }),
      maxIterations: 1,
      agent: agentForRole(ctx, "planner"),
      promptFile: ctx.promptFile("cluster"),
      promptArgs: {
        ...ctx.sharedPromptArgs,
        ...(await skillsPromptArgs(ctx, "planner")),
        PLAN_JSON: JSON.stringify({ issues: planned }, null, 2),
      },
      output: sandcastle.Output.object({ tag: "cluster", schema: clusterSchema }),
    });

    const validated = validateClusters(planned, cluster.output.clusters);
    if (validated) {
      return validated;
    }

    console.warn(
      "Cluster planner output invalid (missing/extra issues or branch mismatch). Falling back to one cluster per issue.",
    );
  } catch (error) {
    if (error instanceof sandcastle.StructuredOutputError) {
      console.warn(`Cluster planner structured output failed: ${error.message}`);
      logClusterValidationIssues(error.cause);

      if (error.rawMatched) {
        const parsed = parseClusterOutput(error.rawMatched);
        const validated = parsed ? validateClusters(planned, parsed) : null;
        if (validated) {
          console.warn("Recovered cluster plan from raw agent output.");
          return validated;
        }
      }
    } else {
      throw error;
    }
  }

  return clustersFromIssues(planned);
}
