/** Host paths bind-mounted into every sandbox worktree (shared cache — not copied per run). */
export const SHARED_SANDBOX_MOUNTS = ["node_modules", ".dora"] as const;

const SANDBOX_ON_READY = [
  "mkdir -p /home/agent/tmp /home/agent/tmp/turbo-cache /home/agent/tmp/xdg-data /home/agent/tmp/xdg-cache /home/agent/.cache/bun",
  // node_modules and .dora are bind-mounted from the host — no per-worktree copy or install.
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
  };
}
