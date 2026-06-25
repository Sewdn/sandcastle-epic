import { defaultImageName } from "@ai-hero/sandcastle/sandboxes/docker";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type {
  AgentHarnessConfig,
  AgentRole,
  EpicSandcastleConfig,
  PromptPaths,
  ResolvedEpicConfig,
} from "./types.js";

const PROMPT_FILES: Record<keyof PromptPaths, string> = {
  plan: "plan-prompt.md",
  cluster: "cluster-prompt.md",
  implement: "implement-prompt.md",
  implementCluster: "implement-cluster-prompt.md",
  review: "review-prompt.md",
  reviewCluster: "review-cluster-prompt.md",
  merge: "merge-prompt.md",
  resolve: "resolve-prompt.md",
  supervisor: "supervisor-prompt.md",
};

const AGENT_ROLES: readonly AgentRole[] = [
  "planner",
  "implementer",
  "reviewer",
  "resolver",
  "merger",
  "supervisor",
];

export const DEFAULT_AGENT_CONFIG: AgentHarnessConfig = {
  harness: "cursor",
  model: "composer-2.5-fast",
  verboseLogging: false,
  skills: [],
};

function resolvePromptPaths(
  repoRoot: string,
  sandcastleDir: string,
  overrides?: Partial<PromptPaths>,
): PromptPaths {
  const relDir = path.relative(repoRoot, sandcastleDir).split(path.sep).join("/");
  const prefix = relDir.startsWith(".") ? `./${relDir}` : `./${relDir}`;

  const defaults = Object.fromEntries(
    Object.entries(PROMPT_FILES).map(([key, file]) => [key, `${prefix}/${file}`]),
  ) as PromptPaths;

  return { ...defaults, ...overrides };
}

function resolveAgentConfig(config: EpicSandcastleConfig): Record<AgentRole, AgentHarnessConfig> {
  const legacyCursorDefault = config.cursorModel
    ? { harness: "cursor" as const, model: config.cursorModel }
    : {};
  const base = {
    ...DEFAULT_AGENT_CONFIG,
    ...legacyCursorDefault,
    ...config.agents?.default,
  };

  return AGENT_ROLES.reduce(
    (resolved, role) => {
      const override = config.agents?.[role];
      resolved[role] = {
        ...base,
        ...override,
        skills: [...new Set([...(base.skills ?? []), ...(override?.skills ?? [])])],
      };
      return resolved;
    },
    {} as Record<AgentRole, AgentHarnessConfig>,
  );
}

export function resolveConfig(config: EpicSandcastleConfig): ResolvedEpicConfig {
  return {
    ...config,
    integrationBranch: `integrate/epic-${config.epic}`,
    epicLabel: `epic:${config.epic}`,
    sandboxImage: defaultImageName(config.repoRoot),
    prompts: resolvePromptPaths(config.repoRoot, config.sandcastleDir, config.prompts),
    agents: resolveAgentConfig(config),
  };
}

/** Host git env so worktrees do not depend on a broken global excludesFile symlink. */
export function configureHostGit(sandcastleDir: string): void {
  const gitconfigPath = sandcastleGitconfigPath(sandcastleDir);
  process.env.GIT_CONFIG_GLOBAL = gitconfigPath;
  process.env.GIT_SSH_COMMAND ??= "ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new";
  syncSandcastleGitIdentity(sandcastleDir, gitconfigPath);
}

export function sandcastleGitconfigPath(sandcastleDir: string): string {
  return path.join(sandcastleDir, "gitconfig.local");
}

function readGlobalGitIdentity(key: "user.name" | "user.email"): string | undefined {
  const proc = Bun.spawnSync(["git", "config", "--global", key]);
  if (proc.exitCode !== 0) {
    return undefined;
  }
  const value = proc.stdout.toString().trim();
  return value.length > 0 ? value : undefined;
}

/** Mirror host git user identity into Sandcastle gitconfig so agent commits succeed. */
function syncSandcastleGitIdentity(sandcastleDir: string, gitconfigPath: string): void {
  const name = readGlobalGitIdentity("user.name");
  const email = readGlobalGitIdentity("user.email");
  if (!name || !email) {
    return;
  }

  let contents = "";
  try {
    contents = readFileSync(gitconfigPath, "utf8");
  } catch {
    const examplePath = path.join(sandcastleDir, "gitconfig.example");
    try {
      contents = readFileSync(examplePath, "utf8");
    } catch {
      contents = `[core]
	excludesfile = empty-ignore
`;
    }
  }

  const withoutUser = contents.replace(/\n\[user\][\s\S]*?(?=\n\[|\s*$)/, "");
  const next = `${withoutUser.trimEnd()}\n\n[user]\n\tname = ${name}\n\temail = ${email}\n`;
  if (next === contents) {
    return;
  }

  mkdirSync(sandcastleDir, { recursive: true });
  writeFileSync(gitconfigPath, next, "utf8");
}
