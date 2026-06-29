import type * as sandcastle from "@ai-hero/sandcastle";
import { runWithTransientRetries } from "./agent-retry.js";
import {
  withSessionCapture,
  type RunCaptureMeta,
  type SessionCaptureCtx,
} from "./session-capture.js";
import type { AgentRole } from "./types.js";

type SandboxRunOptions = Parameters<sandcastle.Sandbox["run"]>[0];
type SandboxRunResult = Awaited<ReturnType<sandcastle.Sandbox["run"]>>;
type SandcastleRunResult = Awaited<ReturnType<typeof sandcastle.run>>;

/** Optional transcript-capture wiring threaded through the run helpers. */
export interface RunCapture {
  readonly ctx: SessionCaptureCtx;
  readonly meta: RunCaptureMeta;
}

type RunCaptureCtx = SessionCaptureCtx & {
  readonly config: SessionCaptureCtx["config"] & {
    readonly epic: string;
    readonly agents: Record<AgentRole, { readonly harness: RunCaptureMeta["harness"]; readonly model: string }>;
  };
};

/** Build capture metadata for a role, filling harness/model/epic from config. */
export function runCaptureFor(
  ctx: RunCaptureCtx,
  role: AgentRole,
  meta: Omit<RunCaptureMeta, "role" | "harness" | "model" | "epic"> &
    Partial<Pick<RunCaptureMeta, "epic">>,
): RunCapture {
  const agent = ctx.config.agents[role];
  return {
    ctx,
    meta: {
      role,
      harness: agent.harness,
      model: agent.model,
      epic: meta.epic ?? ctx.config.epic,
      runName: meta.runName,
      branch: meta.branch,
      issues: meta.issues,
    },
  };
}

/** Run an agent inside an open sandbox, retrying transient provider failures in-place. */
export async function runSandboxAgent(
  sandbox: sandcastle.Sandbox,
  options: SandboxRunOptions,
  capture?: RunCapture,
): Promise<SandboxRunResult> {
  const label = options.name ? `Sandbox agent (${options.name})` : "Sandbox agent";
  const run = () => runWithTransientRetries(label, () => sandbox.run(options));
  return capture ? withSessionCapture(capture.ctx, capture.meta, run) : run();
}

/** Run a host-orchestrated Sandcastle agent (merger/planner/supervisor), with transient retries. */
export async function runSandcastleAgent(
  run: typeof sandcastle.run,
  options: Parameters<typeof sandcastle.run>[0],
  capture?: RunCapture,
): Promise<SandcastleRunResult> {
  const label = options.name ? `Sandcastle agent (${options.name})` : "Sandcastle agent";
  const invoke = () => runWithTransientRetries(label, () => run(options));
  return capture ? withSessionCapture(capture.ctx, capture.meta, invoke) : invoke();
}
