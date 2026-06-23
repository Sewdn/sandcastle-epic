import { $ } from "bun";
import type { EpicContext } from "./context.js";
import {
  closeIntegratedIssue,
  countCommitsAhead,
  featureBranchForIssue,
  integrationMentionsIssue,
} from "./git.js";
import type { PlannedIssue } from "./types.js";

/** True when issue work is on the integration branch and the feature branch has no pending commits. */
export async function isIssueAlreadyIntegrated(
  ctx: EpicContext,
  issueId: string,
  branch?: string,
): Promise<boolean> {
  if (branch && (await countCommitsAhead(ctx, branch)) > 0) {
    return false;
  }

  return integrationMentionsIssue(ctx, issueId);
}

export async function filterAlreadyIntegratedIssues(
  ctx: EpicContext,
  issues: PlannedIssue[],
): Promise<PlannedIssue[]> {
  const kept: PlannedIssue[] = [];

  for (const issue of issues) {
    if (await isIssueAlreadyIntegrated(ctx, issue.id, issue.branch)) {
      console.log(
        `  Skipping #${issue.id} — already on ${ctx.config.integrationBranch} (issue will be reconciled).`,
      );
      continue;
    }
    kept.push(issue);
  }

  return kept;
}

/** Close open GitHub issues whose work is already on the integration branch. */
export async function reconcileMergedOpenIssues(ctx: EpicContext): Promise<readonly string[]> {
  const openIssues = await listOpenAgentIssues(ctx);
  if (openIssues.length === 0) {
    return [];
  }

  const closed: string[] = [];

  for (const issue of openIssues) {
    const branch = await featureBranchForIssue(issue.id);
    if (branch && (await countCommitsAhead(ctx, branch)) > 0) {
      continue;
    }

    if (!(await integrationMentionsIssue(ctx, issue.id))) {
      continue;
    }

    console.log(
      `  Reconciling #${issue.id} — work is on ${ctx.config.integrationBranch}; closing open issue.`,
    );
    await closeIntegratedIssue(
      ctx,
      issue.id,
      `Work for this issue is already on ${ctx.config.integrationBranch}. Closing stale open issue.`,
    );
    closed.push(issue.id);
  }

  if (closed.length > 0) {
    console.log(
      `Reconciled ${closed.length} already-integrated issue(s): ${closed.map((id) => `#${id}`).join(", ")}`,
    );
  }

  return closed;
}

async function listOpenAgentIssues(
  ctx: EpicContext,
): Promise<readonly { readonly id: string; readonly title: string }[]> {
  const result =
    await $`gh issue list --state open --label ready-for-agent --label ${ctx.config.epicLabel} --limit 100 --json number,title`
      .quiet()
      .nothrow();

  if (result.exitCode !== 0) {
    console.error(`  Failed to list open issues: ${result.stderr.toString().trim()}`);
    return [];
  }

  const parsed = JSON.parse(result.stdout.toString()) as Array<{
    number: number;
    title: string;
  }>;

  return parsed.map((issue) => ({
    id: String(issue.number),
    title: issue.title,
  }));
}
