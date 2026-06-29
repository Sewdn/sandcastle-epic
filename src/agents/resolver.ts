import * as sandcastle from "@ai-hero/sandcastle";
import type { EpicContext } from "../context.js";
import { agentRunConfig } from "../agent-run.js";
import { agentForRole } from "../agent-provider.js";
import { clusterPromptArgs } from "../cluster/helpers.js";
import { createSandboxBase } from "../sandbox.js";
import { runCaptureFor, runSandboxAgent } from "../sandbox-agent.js";
import type { PlannedIssue } from "../types.js";
import { skillsPromptArgs } from "../skills.js";

export async function resolveStalledBranches(
  ctx: EpicContext,
  issues: PlannedIssue[],
  stallReason: string,
): Promise<void> {
  if (issues.length === 0) {
    return;
  }

  const label = issues.map((i) => `#${i.id}`).join(", ");
  console.log(`  Resolver run for ${label}: ${stallReason}`);

  const primary = issues[0]!;
  const runName =
    issues.length === 1 ? "resolver" : `resolver-${issues.map((i) => i.id).join("-")}`;
  const sandbox = await sandcastle.createSandbox(
    createSandboxBase({ ...ctx, branch: primary.branch }),
  );

  try {
    await runSandboxAgent(sandbox, {
      ...agentRunConfig(ctx, { role: "resolver", branch: primary.branch, name: runName }),
      maxIterations: Math.max(3, issues.length * 2),
      agent: agentForRole(ctx, "resolver"),
      promptFile: ctx.promptFile("resolve"),
      promptArgs: {
        ...ctx.sharedPromptArgs,
        ...(await skillsPromptArgs(ctx, "resolver")),
        ...clusterPromptArgs({ reason: stallReason, issues }),
        STALL_REASON: stallReason,
        PRIMARY_BRANCH: primary.branch,
      },
    }, runCaptureFor(ctx, "resolver", {
      runName,
      branch: primary.branch,
      issues: issues.map((i) => ({ id: i.id, title: i.title, branch: i.branch })),
    }));
  } finally {
    await sandbox.close();
  }
}
