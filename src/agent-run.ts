import path from "node:path";
import type { LoggingOption } from "@ai-hero/sandcastle";
import type { AgentHarnessConfig, AgentRole } from "./types.js";

/** Sandcastle agent run tuning — long test/lint stretches need a generous idle window. */
export const DEFAULT_AGENT_IDLE_TIMEOUT_SECONDS = 30 * 60;
export const DEFAULT_AGENT_COMPLETION_TIMEOUT_SECONDS = 120;

function parsePositiveIntEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim().length === 0) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export const agentRunOptions = {
  idleTimeoutSeconds: parsePositiveIntEnv(
    process.env.SANDCASTLE_AGENT_IDLE_TIMEOUT_SECONDS,
    DEFAULT_AGENT_IDLE_TIMEOUT_SECONDS,
  ),
  completionTimeoutSeconds: parsePositiveIntEnv(
    process.env.SANDCASTLE_AGENT_COMPLETION_TIMEOUT_SECONDS,
    DEFAULT_AGENT_COMPLETION_TIMEOUT_SECONDS,
  ),
} as const;

function sanitizeBranchForFilename(branch: string): string {
  return branch.replace(/[/\\:*?"<>|]/g, "-");
}

function buildLogFilename(branch: string, name: string, targetBranch?: string): string {
  const nameSuffix = name.toLowerCase().replace(/[^a-z0-9_.-]/g, "-");
  if (targetBranch) {
    return `${sanitizeBranchForFilename(targetBranch)}-${sanitizeBranchForFilename(branch)}-${nameSuffix}.log`;
  }
  return `${sanitizeBranchForFilename(branch)}-${nameSuffix}.log`;
}

export function verboseAgentLogging(
  sandcastleDir: string,
  options: {
    readonly branch: string;
    readonly name: string;
    readonly targetBranch?: string;
  },
): LoggingOption {
  return {
    type: "file",
    path: path.join(
      sandcastleDir,
      "logs",
      buildLogFilename(options.branch, options.name, options.targetBranch),
    ),
    verbose: true,
  };
}

export function agentRunConfig(
  ctx: {
    readonly config: {
      readonly sandcastleDir: string;
      readonly agents: Record<AgentRole, AgentHarnessConfig>;
    };
  },
  options: {
    readonly role: AgentRole;
    readonly branch: string;
    readonly name: string;
    readonly targetBranch?: string;
  },
) {
  const logging = ctx.config.agents[options.role].verboseLogging
    ? { logging: verboseAgentLogging(ctx.config.sandcastleDir, options) }
    : {};

  return {
    ...agentRunOptions,
    name: options.name,
    ...logging,
  };
}
