import * as sandcastle from "@ai-hero/sandcastle";
import type { EpicContext } from "../context.js";
import { agentRunConfig } from "../agent-run.js";
import { agentForRole } from "../agent-provider.js";
import { ensureIntegrationBranch } from "../git.js";
import { formatInterventionLogExcerpt, type InterventionBrief } from "../intervention.js";
import { sandboxRunBase } from "../sandbox.js";
import { skillsPromptArgs } from "../skills.js";

export async function runSupervisor(ctx: EpicContext, brief: InterventionBrief): Promise<void> {
  await ensureIntegrationBranch(ctx, { silent: true });

  const pendingSummary =
    brief.pendingIssues.length > 0
      ? brief.pendingIssues.map((issue) => `- #${issue.id} ${issue.branch}`).join("\n")
      : "(none)";

  await sandcastle.run({
    ...sandboxRunBase(ctx),
    ...agentRunConfig(ctx, {
      role: "supervisor",
      branch: ctx.config.integrationBranch,
      name: "supervisor",
    }),
    maxIterations: 1,
    agent: agentForRole(ctx, "supervisor"),
    promptFile: ctx.promptFile("supervisor"),
    promptArgs: {
      ...ctx.sharedPromptArgs,
      ...(await skillsPromptArgs(ctx, "supervisor")),
      STALL_REASON: brief.reason,
      STALL_DETAIL: brief.detail,
      ITERATION: String(brief.iteration),
      MAX_ITERATIONS: String(brief.maxIterations),
      PENDING_BRANCHES: pendingSummary,
      LOG_EXCERPT: formatInterventionLogExcerpt(brief.recentLogPaths),
    },
  });
}
