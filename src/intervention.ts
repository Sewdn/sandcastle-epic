import { existsSync, statSync } from "node:fs";
import path from "node:path";
import type { EpicContext } from "./context.js";
import type { PlannedIssue } from "./types.js";
import { runSupervisor } from "./agents/supervisor.js";

export type StallReason =
  | "pending-merge-stalled"
  | "max-iterations-approaching"
  | "cluster-implement-failed";

export type InterventionBrief = {
  readonly reason: StallReason;
  readonly iteration: number;
  readonly maxIterations: number;
  readonly pendingIssues: readonly PlannedIssue[];
  readonly recentLogPaths: readonly string[];
  readonly detail: string;
};

function isSupervisorDisabled(): boolean {
  const flag = process.env.SANDCASTLE_SUPERVISOR?.trim().toLowerCase();
  return flag === "0" || flag === "false" || flag === "off";
}

/** Paths only — supervisor reads logs in the sandbox; avoids blowing the host prompt size limit. */
export function formatInterventionLogRefs(logPaths: readonly string[]): string {
  if (logPaths.length === 0) {
    return "(no Sandcastle logs found under .sandcastle/logs/)";
  }

  return logPaths
    .map((logPath, index) => {
      const status = existsSync(logPath) ? "present" : "missing";
      return [
        `${index + 1}. \`${logPath}\` (${status})`,
        `   tail: \`tail -n 60 ${logPath}\``,
        `   errors: \`rg -n "502|Error|FAIL|AgentError|unavailable" ${logPath} | tail -30\``,
      ].join("\n");
    })
    .join("\n\n");
}

/** Collect recent Sandcastle log files, newest first. */
export function recentSandcastleLogPaths(sandcastleDir: string, limit = 6): string[] {
  const logsDir = path.join(sandcastleDir, "logs");
  if (!existsSync(logsDir)) {
    return [];
  }

  const entries = Bun.spawnSync(["find", logsDir, "-maxdepth", "1", "-name", "*.log", "-type", "f"]).stdout
    .toString()
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return entries
    .map((file) => ({ file, mtime: statSync(file).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit)
    .map((entry) => entry.file);
}

/** Invoke the supervisor agent when the orchestrator detects a stall or failure pattern. */
export async function maybeIntervene(ctx: EpicContext, brief: InterventionBrief): Promise<void> {
  if (isSupervisorDisabled()) {
    console.log("  Supervisor disabled (SANDCASTLE_SUPERVISOR=0) — skipping intervention.");
    return;
  }

  console.log(`\nSupervisor intervention — ${brief.reason}`);
  console.log(`  ${brief.detail}`);

  try {
    await runSupervisor(ctx, brief);
  } catch (error) {
    console.error(`  Supervisor agent failed: ${error}`);
  }
}
