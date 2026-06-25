import type * as sandcastle from "@ai-hero/sandcastle";
import { runWithTransientRetries } from "./agent-retry.js";

type SandboxRunOptions = Parameters<sandcastle.Sandbox["run"]>[0];

/** Run an agent inside an open sandbox, retrying transient provider failures in-place. */
export async function runSandboxAgent(
  sandbox: sandcastle.Sandbox,
  options: SandboxRunOptions,
): Promise<void> {
  const label = options.name ? `Sandbox agent (${options.name})` : "Sandbox agent";
  await runWithTransientRetries(label, () => sandbox.run(options));
}

/** Run a host-orchestrated Sandcastle agent (merger/planner/supervisor), with transient retries. */
export async function runSandcastleAgent(
  run: typeof sandcastle.run,
  options: Parameters<typeof sandcastle.run>[0],
): Promise<Awaited<ReturnType<typeof sandcastle.run>>> {
  const label = options.name ? `Sandcastle agent (${options.name})` : "Sandcastle agent";
  return runWithTransientRetries(label, () => run(options));
}
