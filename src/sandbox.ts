/** Paths copied from the host repo into each sandbox worktree before `bun install`. */
export const COPY_TO_WORKTREE = ["node_modules", ".dora"] as const;

const SANDBOX_ON_READY = [
  "mkdir -p /home/agent/tmp /home/agent/tmp/turbo-cache /home/agent/tmp/xdg-data /home/agent/tmp/xdg-cache /home/agent/.cache/bun",
  "if [ -d node_modules ] && [ -f bun.lock ]; then bun install --frozen-lockfile --ignore-scripts; else bun install --ignore-scripts; fi",
].join(" && ");

export const sandboxHooks = {
  sandbox: {
    onSandboxReady: [{ command: SANDBOX_ON_READY }],
  },
};

export type SandboxHooks = typeof sandboxHooks;

export function sandboxRunBase(ctx: {
  readonly config: { readonly repoRoot: string };
  readonly sandboxDocker: ReturnType<typeof import("@ai-hero/sandcastle/sandboxes/docker").docker>;
  readonly hooks: SandboxHooks;
}) {
  return {
    cwd: ctx.config.repoRoot,
    sandbox: ctx.sandboxDocker,
    hooks: ctx.hooks,
  };
}

export function createSandboxBase(ctx: {
  readonly config: { readonly repoRoot: string };
  readonly sandboxDocker: ReturnType<typeof import("@ai-hero/sandcastle/sandboxes/docker").docker>;
  readonly hooks: SandboxHooks;
  readonly branch: string;
}) {
  return {
    branch: ctx.branch,
    cwd: ctx.config.repoRoot,
    sandbox: ctx.sandboxDocker,
    hooks: ctx.hooks,
    copyToWorktree: [...COPY_TO_WORKTREE],
  };
}
