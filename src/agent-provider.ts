import * as sandcastle from "@ai-hero/sandcastle";
import type { AgentProvider } from "@ai-hero/sandcastle";
import type { EpicContext } from "./context.js";
import {
  transcriptClaudeProjectsDirFor,
  transcriptCodexSessionsDirFor,
  transcriptPiSessionsDirFor,
} from "./session-capture.js";
import type { AgentHarness, AgentRole } from "./types.js";

const CLAUDE_SANDBOX_PROJECTS_DIR = "/home/agent/.claude/projects";
const CODEX_SANDBOX_SESSIONS_DIR = "/home/agent/.codex/sessions";
const PI_SANDBOX_SESSIONS_DIR = "/home/agent/.pi/agent/sessions";

function opencodeProviderEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  const apiKey = process.env.ZAI_API_KEY?.trim();
  if (apiKey) {
    env.ZAI_API_KEY = apiKey;
  }
  return env;
}

function createAgentProvider(
  sandcastleDir: string,
  harness: AgentHarness,
  model: string,
): AgentProvider {
  switch (harness) {
    case "cursor":
      return sandcastle.cursor(model);
    case "codex":
      return sandcastle.codex(model, {
        sessionStorage: {
          hostSessionsDir: transcriptCodexSessionsDirFor(sandcastleDir),
          sandboxSessionsDir: CODEX_SANDBOX_SESSIONS_DIR,
        },
      });
    case "claudeCode":
      return sandcastle.claudeCode(model, {
        sessionStorage: {
          hostProjectsDir: transcriptClaudeProjectsDirFor(sandcastleDir),
          sandboxProjectsDir: CLAUDE_SANDBOX_PROJECTS_DIR,
        },
      });
    case "pi":
      return sandcastle.pi(model, {
        sessionStorage: {
          hostSessionsDir: transcriptPiSessionsDirFor(sandcastleDir),
          sandboxSessionsDir: PI_SANDBOX_SESSIONS_DIR,
        },
      });
    case "opencode":
      return sandcastle.opencode(model, { env: opencodeProviderEnv() });
    case "copilot":
      return sandcastle.copilot(model);
  }
}

export function agentForRole(ctx: EpicContext, role: AgentRole): AgentProvider {
  const agent = ctx.config.agents[role];
  return createAgentProvider(ctx.config.sandcastleDir, agent.harness, agent.model);
}
