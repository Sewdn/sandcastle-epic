import * as sandcastle from "@ai-hero/sandcastle";
import type { EpicContext } from "../context.js";
import { ensureIntegrationBranch, issuesWithCommits } from "../git.js";
import { agentRunConfig } from "../agent-run.js";
import { agentForRole } from "../agent-provider.js";
import { clusterPromptArgs, reviewerRunName } from "../cluster/helpers.js";
import { branchTipSha, markReviewed, shouldSkipReview } from "../progress.js";
import { createSandboxBase } from "../sandbox.js";
import { runSandboxAgent } from "../sandbox-agent.js";
import type { IssueCluster, PlannedIssue } from "../types.js";
import { affectedPackageNames, formatAffectedValidationScope } from "../affected.js";
import { refreshDoraIndex } from "../dora.js";
import { skillsPromptArgs } from "../skills.js";

async function filterNeedsReview(
  ctx: EpicContext,
  issues: PlannedIssue[],
): Promise<{ needsReview: PlannedIssue[]; skipped: PlannedIssue[] }> {
  const needsReview: PlannedIssue[] = [];
  const skipped: PlannedIssue[] = [];

  for (const issue of issues) {
    const tip = await branchTipSha(issue.branch);
    if (tip && shouldSkipReview(ctx.config.sandcastleDir, issue.branch, tip)) {
      skipped.push(issue);
    } else {
      needsReview.push(issue);
    }
  }

  return { needsReview, skipped };
}

async function validationScopeForIssue(ctx: EpicContext, issue: PlannedIssue): Promise<string> {
  const packages = await affectedPackageNames(
    ctx.config.repoRoot,
    ctx.config.integrationBranch,
    issue.branch,
  );
  return formatAffectedValidationScope(packages);
}

async function validationScopeForIssues(
  ctx: EpicContext,
  issues: PlannedIssue[],
): Promise<string> {
  const names = new Set<string>();
  for (const issue of issues) {
    for (const pkg of await affectedPackageNames(
      ctx.config.repoRoot,
      ctx.config.integrationBranch,
      issue.branch,
    )) {
      names.add(pkg);
    }
  }
  return formatAffectedValidationScope([...names].sort());
}

export async function reviewIssues(
  ctx: EpicContext,
  issues: PlannedIssue[],
  sandbox?: sandcastle.Sandbox,
  plannerSkills: readonly string[] = [],
): Promise<PlannedIssue[]> {
  const withCommits = await issuesWithCommits(ctx, issues);
  if (withCommits.length === 0) {
    return [];
  }

  const { needsReview, skipped } = await filterNeedsReview(ctx, withCommits);
  if (skipped.length > 0) {
    console.log(
      `  Skipping review for ${skipped.length} branch(es) already reviewed at current tip: ${skipped.map((i) => `#${i.id}`).join(", ")}`,
    );
  }

  if (needsReview.length === 0) {
    return withCommits;
  }

  const label = needsReview.map((i) => `#${i.id}`).join(", ");
  console.log(`  Reviewing ${needsReview.length} branch(es): ${label}`);

  const ownSandbox = sandbox === undefined;
  const sb =
    sandbox ??
    (await sandcastle.createSandbox(createSandboxBase({ ...ctx, branch: needsReview[0]!.branch })));

  const cluster: IssueCluster = {
    reason: "Review grouped branches",
    issues: needsReview,
  };

  const runName = reviewerRunName(needsReview);

  // Sandcastle injects TARGET_BRANCH from the host checkout; keep host on the integration branch.
  await ensureIntegrationBranch(ctx, { silent: true });

  try {
    if (needsReview.length === 1) {
      const issue = needsReview[0]!;
      const validationScope = await validationScopeForIssue(ctx, issue);
      await runSandboxAgent(sb, {
        ...agentRunConfig(ctx, { role: "reviewer", branch: needsReview[0]!.branch, name: runName }),
        maxIterations: 1,
        agent: agentForRole(ctx, "reviewer"),
        promptFile: ctx.promptFile("review"),
        promptArgs: {
          ...ctx.sharedPromptArgs,
          ...(await skillsPromptArgs(ctx, "reviewer", [issue], plannerSkills)),
          BRANCH: issue.branch,
          VALIDATION_SCOPE: validationScope,
        },
      });
    } else {
      const validationScope = await validationScopeForIssues(ctx, needsReview);
      await runSandboxAgent(sb, {
        ...agentRunConfig(ctx, { role: "reviewer", branch: needsReview[0]!.branch, name: runName }),
        maxIterations: needsReview.length,
        agent: agentForRole(ctx, "reviewer"),
        promptFile: ctx.promptFile("reviewCluster"),
        promptArgs: {
          ...ctx.sharedPromptArgs,
          ...(await skillsPromptArgs(ctx, "reviewer", needsReview, plannerSkills)),
          ...clusterPromptArgs(cluster),
          VALIDATION_SCOPE: validationScope,
        },
      });
    }

    for (const issue of needsReview) {
      const tip = await branchTipSha(issue.branch);
      if (tip) {
        markReviewed(ctx.config.sandcastleDir, issue.branch, tip);
      }
      await refreshDoraIndex(ctx, issue.branch);
    }
  } catch (error) {
    console.error(`  Review agent failed: ${error}`);
    // Branches with commits may still be mergeable — let the caller attempt merge.
  } finally {
    if (ownSandbox) {
      await sb.close();
    }
  }

  return issuesWithCommits(ctx, withCommits);
}
