import * as sandcastle from "@ai-hero/sandcastle";
import type { AgentProvider } from "@ai-hero/sandcastle";
import type { EpicContext } from "./context.js";
import type { AgentHarness, AgentRole } from "./types.js";

function createAgentProvider(harness: AgentHarness, model: string): AgentProvider {
  switch (harness) {
    case "cursor":
      return sandcastle.cursor(model);
    case "codex":
      return sandcastle.codex(model);
    case "claudeCode":
      return sandcastle.claudeCode(model);
    case "pi":
      return sandcastle.pi(model);
    case "opencode":
      return sandcastle.opencode(model);
    case "copilot":
      return sandcastle.copilot(model);
  }
}

export function agentForRole(ctx: EpicContext, role: AgentRole): AgentProvider {
  const agent = ctx.config.agents[role];
  return createAgentProvider(agent.harness, agent.model);
}
