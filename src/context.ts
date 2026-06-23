import { docker } from "@ai-hero/sandcastle/sandboxes/docker";
import { configureHostGit, resolveConfig } from "./config.js";
import { sandboxHooks } from "./sandbox.js";
import type { EpicSandcastleConfig, PromptPaths, ResolvedEpicConfig } from "./types.js";

const EFFECT_REFERENCE_PATH = "/home/agent/.local/share/effect-solutions/effect";
const HOST_EFFECT_REFERENCE_PATH = `${process.env.HOME}/.local/share/effect-solutions/effect`;
const AGENTS_SKILLS_PATH = "/home/agent/.agents/skills";
const CLAUDE_SKILLS_PATH = "/home/agent/.claude/skills";
const CURSOR_SKILLS_PATH = "/home/agent/.cursor/skills";

export type EpicContext = {
  readonly config: ResolvedEpicConfig;
  readonly sandboxDocker: ReturnType<typeof docker>;
  readonly hooks: typeof sandboxHooks;
  readonly sharedPromptArgs: {
    readonly EPIC_LABEL: string;
    readonly INTEGRATION_BRANCH: string;
  };
  promptFile(key: keyof PromptPaths): string;
};

export function createEpicContext(config: EpicSandcastleConfig): EpicContext {
  const resolved = resolveConfig(config);

  const sandboxDocker = docker({
    imageName: resolved.sandboxImage,
    mounts: [
      {
        hostPath: "~/.local/share/effect-solutions/effect",
        sandboxPath: EFFECT_REFERENCE_PATH,
        readonly: true,
      },
      {
        hostPath: "~/.local/share/effect-solutions/effect",
        sandboxPath: HOST_EFFECT_REFERENCE_PATH,
        readonly: true,
      },
      {
        hostPath: "~/.agents/skills",
        sandboxPath: AGENTS_SKILLS_PATH,
        readonly: true,
      },
      {
        hostPath: "~/.claude/skills",
        sandboxPath: CLAUDE_SKILLS_PATH,
        readonly: true,
      },
      {
        hostPath: "~/.cursor/skills",
        sandboxPath: CURSOR_SKILLS_PATH,
        readonly: true,
      },
    ],
    env: {
      HOME: "/home/agent",
      TMPDIR: "/home/agent/tmp",
      BUN_INSTALL_CACHE_DIR: "/home/agent/.cache/bun",
      TURBO_CACHE_DIR: "/home/agent/tmp/turbo-cache",
      TURBO_TELEMETRY_DISABLED: "1",
      GIT_SSH_COMMAND: "ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new",
      XDG_DATA_HOME: "/home/agent/tmp/xdg-data",
      XDG_CACHE_HOME: "/home/agent/tmp/xdg-cache",
    },
  });

  return {
    config: resolved,
    sandboxDocker,
    hooks: sandboxHooks,
    sharedPromptArgs: {
      EPIC_LABEL: resolved.epicLabel,
      INTEGRATION_BRANCH: resolved.integrationBranch,
    },
    promptFile: (key) => resolved.prompts[key],
  };
}

/** Configure host git and return a ready-to-run epic context. */
export function createConfiguredEpicContext(config: EpicSandcastleConfig): EpicContext {
  configureHostGit(config.sandcastleDir);
  return createEpicContext(config);
}
