import { $ } from "bun";
import type { EpicContext } from "./context.js";
import type { AgentRole, PlannedIssue } from "./types.js";

const AGENT_SKILLS_SECTION = /^## Agent skills\s*$/im;
const NEXT_SECTION = /^##\s+/m;

function unique(items: readonly string[]): string[] {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

function extractAgentSkillsSection(body: string): string | null {
  const match = AGENT_SKILLS_SECTION.exec(body);
  if (!match || match.index === undefined) {
    return null;
  }

  const start = match.index + match[0].length;
  const rest = body.slice(start).trim();
  const next = NEXT_SECTION.exec(rest);
  return (next ? rest.slice(0, next.index) : rest).trim() || null;
}

async function issueAgentSkills(issueId: string): Promise<string | null> {
  const result = await $`gh issue view ${issueId} --json body --jq .body`.quiet().nothrow();
  if (result.exitCode !== 0) {
    return null;
  }
  return extractAgentSkillsSection(result.stdout.toString());
}

async function issueSkillsSummary(issues: readonly PlannedIssue[]): Promise<string[]> {
  const summaries: string[] = [];
  for (const issue of issues) {
    const section = await issueAgentSkills(issue.id);
    if (section) {
      summaries.push(`Issue #${issue.id} (${issue.title}):\n${section}`);
    }
  }
  return summaries;
}

export async function skillsPromptArgs(
  ctx: EpicContext,
  role: AgentRole,
  issues: readonly PlannedIssue[] = [],
  plannerSkills: readonly string[] = [],
): Promise<{ readonly SKILLS_FORMATTED: string }> {
  const configured = unique(ctx.config.agents[role].skills);
  const planned = unique(plannerSkills);
  const issueSections = await issueSkillsSummary(issues);

  const sections: string[] = [];
  if (configured.length > 0) {
    sections.push(
      `Configured for this ${role} agent:\n${configured.map((skill) => `- ${skill}`).join("\n")}`,
    );
  }
  if (planned.length > 0) {
    sections.push(
      `Recommended by the planner for this session:\n${planned.map((skill) => `- ${skill}`).join("\n")}`,
    );
  }
  if (issueSections.length > 0) {
    sections.push(`From the issue body:\n${issueSections.join("\n\n")}`);
  }

  return {
    SKILLS_FORMATTED: sections.join("\n\n") || "None beyond the repository defaults.",
  };
}
