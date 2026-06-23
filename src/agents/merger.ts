import * as sandcastle from "@ai-hero/sandcastle";
import type { EpicContext } from "../context.js";
import { agentRunConfig } from "../agent-run.js";
import { agentForRole } from "../agent-provider.js";
import { sandboxRunBase } from "../sandbox.js";
import type { PlannedIssue } from "../types.js";
import { skillsPromptArgs } from "../skills.js";

export async function mergeIssueBranchesWithAgent(
  ctx: EpicContext,
  issues: PlannedIssue[],
): Promise<void> {
  await sandcastle.run({
    ...sandboxRunBase(ctx),
    ...agentRunConfig(ctx, {
      role: "merger",
      branch: ctx.config.integrationBranch,
      name: "merger",
    }),
    maxIterations: 1,
    agent: agentForRole(ctx, "merger"),
    promptFile: ctx.promptFile("merge"),
    promptArgs: {
      ...ctx.sharedPromptArgs,
      ...(await skillsPromptArgs(ctx, "merger")),
      BRANCHES: issues.map((i) => `- ${i.branch}`).join("\n"),
      ISSUES: issues.map((i) => `- ${i.id}: ${i.title}`).join("\n"),
    },
  });
}
