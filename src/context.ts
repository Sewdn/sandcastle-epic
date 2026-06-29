import path from "node:path";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";
import { configureHostGit, resolveConfig } from "./config.js";
import { sandboxHooks, SHARED_SANDBOX_MOUNTS } from "./sandbox.js";
import {
  ensureTranscriptDirs,
  transcriptChatsDirFor,
  transcriptClaudeProjectsDirFor,
  transcriptCodexSessionsDirFor,
  transcriptPiSessionsDirFor,
} from "./session-capture.js";
import type { ProjectMap } from "./project-map.js";
import type { EpicSandcastleConfig, PromptPaths, ResolvedEpicConfig } from "./types.js";

const EFFECT_REFERENCE_PATH = "/home/agent/.local/share/effect-solutions/effect";
const HOST_EFFECT_REFERENCE_PATH = `${process.env.HOME}/.local/share/effect-solutions/effect`;
const AGENTS_SKILLS_PATH = "/home/agent/.agents/skills";
const CLAUDE_SKILLS_PATH = "/home/agent/.claude/skills";
const CURSOR_SKILLS_PATH = "/home/agent/.cursor/skills";
const CURSOR_CHATS_PATH = "/home/agent/.cursor/chats";
const CLAUDE_PROJECTS_PATH = "/home/agent/.claude/projects";
const CODEX_SESSIONS_PATH = "/home/agent/.codex/sessions";
const PI_SESSIONS_PATH = "/home/agent/.pi/agent/sessions";

export type EpicContext = {
  readonly config: ResolvedEpicConfig;
  readonly projectMap: ProjectMap | null;
  readonly sandboxDocker: ReturnType<typeof docker>;
  readonly hooks: typeof sandboxHooks;
  readonly sharedPromptArgs: {
    readonly EPIC_LABEL: string;
    readonly INTEGRATION_BRANCH: string;
  };
  promptFile(key: keyof PromptPaths): string;
};

function sharedRepoMounts(repoRoot: string) {
  return SHARED_SANDBOX_MOUNTS.map((segment) => ({
    hostPath: path.join(repoRoot, segment),
    sandboxPath: `/home/agent/workspace/${segment}`,
    readonly: segment === "node_modules",
  }));
}

export function createEpicContext(config: EpicSandcastleConfig): EpicContext {
  const resolved = resolveConfig(config);

  // Persist agent transcripts under `.sandcastle/transcripts/` with per-harness
  // subdirs bind-mounted into the sandbox. Created up front so docker mount
  // existence checks pass on the first run.
  ensureTranscriptDirs(resolved.sandcastleDir);

  const sandboxDocker = docker({
    imageName: resolved.sandboxImage,
    mounts: [
      ...sharedRepoMounts(resolved.repoRoot),
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
      {
        hostPath: transcriptChatsDirFor(resolved.sandcastleDir),
        sandboxPath: CURSOR_CHATS_PATH,
      },
      {
        hostPath: transcriptClaudeProjectsDirFor(resolved.sandcastleDir),
        sandboxPath: CLAUDE_PROJECTS_PATH,
      },
      {
        hostPath: transcriptCodexSessionsDirFor(resolved.sandcastleDir),
        sandboxPath: CODEX_SESSIONS_PATH,
      },
      {
        hostPath: transcriptPiSessionsDirFor(resolved.sandcastleDir),
        sandboxPath: PI_SESSIONS_PATH,
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
    projectMap: config.projectMap ?? null,
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
