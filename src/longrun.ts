import type { EpicContext } from "./context.js";
import { createEpicContext } from "./context.js";
import {
  filterEpicsToRun,
  loadCompletedEpics,
  markEpicCompleted,
  priorCompletedEpic,
} from "./completed-epics.js";
import { installHostDependencies } from "./deps.js";
import { integrationBranchForEpic } from "./epics.js";
import { parseEpicList, validateEpicSequence } from "./epics.js";
import { loadCanonicalEpicSequence, loadEpicSequenceForPhase } from "./backlog.js";
import {
  bootstrapIntegrationBranchFromEpic,
  pushIntegrationBranchIfEnabled,
  type LongRunHandoffOptions,
} from "./git-main.js";
import { listPendingMergeIssues } from "./git.js";
import { runEpicLoop } from "./loop.js";
import type { EpicSandcastleConfig, LongRunSandcastleConfig } from "./types.js";

export type LongRunOrchestrationOptions = LongRunSandcastleConfig;

export type LongRunOrchestrationResult = {
  readonly epicsRun: readonly string[];
  readonly skippedEpics: readonly string[];
  readonly completedEpics: readonly string[];
  readonly stoppedAt: string | null;
  readonly stopReason: string | null;
  /** Tip of the integration branch chain after a successful run (null if nothing completed). */
  readonly finalIntegrationBranch: string | null;
};

function handoffOptions(config: LongRunOrchestrationOptions): LongRunHandoffOptions {
  return {
    pushRemotes: config.pushRemotes,
  };
}

async function prepareEpicStart(
  epic: string,
  baseConfig: EpicSandcastleConfig,
): Promise<EpicContext> {
  return createEpicContext({ ...baseConfig, epic });
}

async function prepareFirstEpicInChain(
  firstEpic: string,
  baseConfig: EpicSandcastleConfig,
  longRun: LongRunOrchestrationOptions,
  completedEpics: readonly string[],
): Promise<void> {
  const prior = priorCompletedEpic(
    firstEpic,
    completedEpics,
    longRun.epics,
    longRun.canonicalEpicSequence,
  );
  if (prior) {
    console.log(
      `  Resuming after completed ${prior}: bootstrapping ${integrationBranchForEpic(firstEpic)}…`,
    );
    await bootstrapIntegrationBranchFromEpic(prior, firstEpic, handoffOptions(longRun));
  }

  await installHostDependencies(baseConfig.repoRoot);
}

export async function runLongEpicOrchestration(
  baseConfig: EpicSandcastleConfig,
  longRun: LongRunOrchestrationOptions,
): Promise<LongRunOrchestrationResult> {
  validateEpicSequence(longRun.epics);

  const sandcastleDir = baseConfig.sandcastleDir;
  const persistedCompleted = loadCompletedEpics(sandcastleDir);
  const { toRun: epicsToRun, skipped: skippedEpics } = filterEpicsToRun(
    longRun.epics,
    sandcastleDir,
  );

  if (skippedEpics.length > 0) {
    console.log(`Skipping already completed epic(s): ${skippedEpics.join(", ")}`);
  }

  if (epicsToRun.length === 0) {
    console.log("\nLong-run orchestration: all epics in this sequence are already completed.");
    const lastCompleted =
      [...longRun.epics].reverse().find((epic) => persistedCompleted.includes(epic)) ?? null;
    return {
      epicsRun: [],
      skippedEpics,
      completedEpics: persistedCompleted.filter((epic) => longRun.epics.includes(epic)),
      stoppedAt: null,
      stopReason: null,
      finalIntegrationBranch: lastCompleted ? integrationBranchForEpic(lastCompleted) : null,
    };
  }

  console.log(
    `Long-run Sandcastle: ${epicsToRun.length} epic(s) to run — ${epicsToRun.join(" → ")}`,
  );
  if (longRun.phase) {
    console.log(`  Phase scope: ${longRun.phase}`);
  }
  console.log(
    "  Handoff: each completed integrate/epic-* seeds the next integration branch (no merge to main).",
  );
  console.log("  Merge to main only after manual review when the full sequence is done.");
  console.log(`  Completed-epic state: ${sandcastleDir}/state/completed-epics.json`);

  await prepareFirstEpicInChain(epicsToRun[0]!, baseConfig, longRun, persistedCompleted);

  const sessionCompleted: string[] = [];

  for (const [index, epic] of epicsToRun.entries()) {
    console.log(`\n${"=".repeat(72)}`);
    console.log(
      `EPIC ${index + 1}/${epicsToRun.length}: ${epic} (${integrationBranchForEpic(epic)})`,
    );
    console.log(`${"=".repeat(72)}\n`);

    const ctx =
      index === 0
        ? createEpicContext({ ...baseConfig, epic })
        : await prepareEpicStart(epic, baseConfig);

    const result = await runEpicLoop(ctx);

    if (!result.completed) {
      const pending = await listPendingMergeIssues(ctx);
      const detail =
        result.reason === "pending-merges"
          ? `${pending.length} unmerged feature branch(es)`
          : `maxIterations (${baseConfig.maxIterations}) exhausted with agent work remaining`;

      console.error(`\nEpic ${epic} did not complete: ${detail}.`);
      console.error("  Stopping long-run sequence.");

      const allCompleted = [...persistedCompleted, ...sessionCompleted];
      return {
        epicsRun: epicsToRun.slice(0, index + 1),
        skippedEpics,
        completedEpics: allCompleted,
        stoppedAt: epic,
        stopReason: result.reason,
        finalIntegrationBranch:
          allCompleted.length > 0
            ? integrationBranchForEpic(allCompleted[allCompleted.length - 1]!)
            : ctx.config.integrationBranch,
      };
    }

    markEpicCompleted(sandcastleDir, epic);
    sessionCompleted.push(epic);
    console.log(`\nEpic ${epic} agent queue complete (recorded in completed-epics state).`);

    await pushIntegrationBranchIfEnabled(
      ctx.config.integrationBranch,
      handoffOptions(longRun),
      `\nPushing ${ctx.config.integrationBranch} (all issue merges landed)…`,
    );

    const nextEpic = epicsToRun[index + 1];
    if (nextEpic) {
      const previousBranch = ctx.config.integrationBranch;
      const nextBranch = integrationBranchForEpic(nextEpic);
      console.log(`\n=== Handoff: ${nextBranch} from ${previousBranch} ===\n`);
      await bootstrapIntegrationBranchFromEpic(epic, nextEpic, handoffOptions(longRun));
      await installHostDependencies(baseConfig.repoRoot);
    }
  }

  const allCompleted = [...persistedCompleted, ...sessionCompleted];
  const finalIntegrationBranch =
    sessionCompleted.length > 0
      ? integrationBranchForEpic(sessionCompleted[sessionCompleted.length - 1]!)
      : null;

  console.log("\nLong-run orchestration finished.");
  console.log(`  Completed this session: ${sessionCompleted.join(", ") || "(none)"}`);
  console.log(
    `  All recorded completed: ${allCompleted.filter((epic) => longRun.epics.includes(epic)).join(", ") || "(none)"}`,
  );
  if (finalIntegrationBranch) {
    console.log(
      `  All work is on ${finalIntegrationBranch}. Review and merge to main manually when ready.`,
    );
  }

  return {
    epicsRun: [...epicsToRun],
    skippedEpics,
    completedEpics: allCompleted.filter((epic) => longRun.epics.includes(epic)),
    stoppedAt: null,
    stopReason: null,
    finalIntegrationBranch,
  };
}

export function resolveLongRunConfig(env: {
  epics?: string;
  push?: string;
  phase?: string;
  repoRoot: string;
  epicsDir?: string;
  /** @deprecated Prefer repoRoot-only; canonical order comes from issue backlog YAML. */
  defaultEpics?: readonly string[];
}): LongRunOrchestrationOptions {
  const discovery = env.epicsDir ? { epicsDir: env.epicsDir } : {};
  const canonicalEpics = env.defaultEpics ?? loadCanonicalEpicSequence(env.repoRoot, discovery);
  const phase = env.phase?.trim();
  const phaseEpics = phase ? loadEpicSequenceForPhase(env.repoRoot, phase, discovery) : canonicalEpics;
  const epics = parseEpicList(env.epics, phaseEpics);

  if (phase) {
    const allowed = new Set(phaseEpics);
    for (const epic of epics) {
      if (!allowed.has(epic)) {
        throw new Error(
          `Epic '${epic}' is not in phase '${phase}'. Phase epics: ${phaseEpics.join(", ")}`,
        );
      }
    }
  }

  return {
    epics,
    pushRemotes: env.push === "1" || env.push?.toLowerCase() === "true",
    phase,
    canonicalEpicSequence: canonicalEpics,
  };
}
