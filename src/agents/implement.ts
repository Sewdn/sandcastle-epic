import * as sandcastle from "@ai-hero/sandcastle";
import type { EpicContext } from "../context.js";
import { ensureIssueBranches, issuesWithCommits } from "../git.js";
import { clusterLabel, clusterPromptArgs, implementerRunName } from "../cluster/helpers.js";
import { createSandboxBase } from "../sandbox.js";
import { agentRunConfig } from "../agent-run.js";
import { mergeIssueBranches } from "../merge.js";
import { resolveStalledBranches } from "./resolver.js";
import { reviewIssues } from "./review.js";
import type { IssueCluster, PlannedIssue } from "../types.js";
import { agentForRole } from "../agent-provider.js";
import { reconcileHostDependencies } from "../deps.js";
import { refreshDoraIndex } from "../dora.js";
import { skillsPromptArgs } from "../skills.js";

export async function implementCluster(ctx: EpicContext, cluster: IssueCluster): Promise<void> {
  const ids = clusterLabel(cluster);
  console.log(
    `\nImplementing cluster [${ids}] — ${cluster.issues.length} issue(s) in one implementer run`,
  );
  console.log(`  Reason: ${cluster.reason}`);

  await ensureIssueBranches(ctx, cluster.issues);
  for (const [index, issue] of cluster.issues.entries()) {
    console.log(
      `  ${index + 1}/${cluster.issues.length}. #${issue.id}: ${issue.title} → ${issue.branch}`,
    );
  }

  const primary = cluster.issues[0]!;
  if (cluster.issues.length > 1) {
    console.log(
      `  Sandbox opens on ${primary.branch}; agent works through the list above in one session`,
    );
  }

  const runName = implementerRunName(cluster);
  const sandbox = await sandcastle.createSandbox(
    createSandboxBase({ ...ctx, branch: primary.branch }),
  );

  try {
    if (cluster.issues.length === 1) {
      const issue = primary;
      await sandbox.run({
        ...agentRunConfig(ctx, { role: "implementer", branch: primary.branch, name: runName }),
        maxIterations: 100,
        agent: agentForRole(ctx, "implementer"),
        promptFile: ctx.promptFile("implement"),
        promptArgs: {
          ...ctx.sharedPromptArgs,
          ...(await skillsPromptArgs(ctx, "implementer", [issue], cluster.skills?.implementation)),
          TASK_ID: issue.id,
          ISSUE_TITLE: issue.title,
          BRANCH: issue.branch,
        },
      });
    } else {
      await sandbox.run({
        ...agentRunConfig(ctx, { role: "implementer", branch: primary.branch, name: runName }),
        maxIterations: 100 * cluster.issues.length,
        agent: agentForRole(ctx, "implementer"),
        promptFile: ctx.promptFile("implementCluster"),
        promptArgs: {
          ...ctx.sharedPromptArgs,
          ...(await skillsPromptArgs(
            ctx,
            "implementer",
            cluster.issues,
            cluster.skills?.implementation,
          )),
          ...clusterPromptArgs(cluster),
          PRIMARY_BRANCH: primary.branch,
          ISSUE_ORDER: cluster.issues
            .map((i, n) => `${n + 1}. #${i.id}: ${i.title} → ${i.branch}`)
            .join("\n"),
        },
      });
    }
  } finally {
    await sandbox.close();
  }

  for (const issue of cluster.issues) {
    await refreshDoraIndex(ctx, issue.branch);
  }

  let ready: PlannedIssue[];
  try {
    ready = await reviewIssues(ctx, cluster.issues, undefined, cluster.skills?.review);
  } catch (error) {
    console.error(`  Review failed: ${error}`);
    return;
  }

  if (ready.length === 0) {
    console.log("  No branches with unmerged commits after review.");
    return;
  }

  console.log(`  Merging ${ready.length} branch(es) into ${ctx.config.integrationBranch}…`);
  try {
    await mergeIssueBranches(ctx, ready);
    await reconcileHostDependencies(ctx.config.repoRoot);
  } catch (error) {
    console.error(`  Merge failed: ${error}`);
    const stillPending = await issuesWithCommits(ctx, cluster.issues);
    if (stillPending.length > 0) {
      await resolveStalledBranches(
        ctx,
        stillPending,
        "Cluster implement/review succeeded but host merge failed.",
      ).catch((resolverError) => {
        console.error(`  Resolver failed: ${resolverError}`);
      });
    }
    throw new Error(`Merge failed: ${error}`, { cause: error });
  }
}
