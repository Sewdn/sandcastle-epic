import type { EpicContext } from "./context.js";
import { createEpicContext } from "./context.js";
import { priorCompletedEpic } from "./completed-epics.js";
import { installHostDependencies } from "./deps.js";
import { integrationBranchForEpic, parseEpicList, validateEpicSequence } from "./epics.js";
import { loadCanonicalEpicSequence, loadEpicSequenceForPhase } from "./backlog.js";
import {
  bootstrapIntegrationBranchFromEpic,
  pushIntegrationBranchIfEnabled,
  type LongRunHandoffOptions,
} from "./git-main.js";
import {
  filterEpicsFromProjectMap,
  loadProjectMapFromGithub,
  logProjectMapSummary,
  type ProjectMap,
} from "./project-map.js";
import { printProjectMapReport } from "./project-map-report.js";
import { listEpicPendingMergeIssues } from "./planning.js";
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
  readonly projectMap: ProjectMap;
};

function handoffOptions(
  config: LongRunOrchestrationOptions,
  baseConfig: EpicSandcastleConfig,
): LongRunHandoffOptions {
  return {
    pushRemotes: config.pushRemotes,
    repoRoot: baseConfig.repoRoot,
    sandcastleDir: baseConfig.sandcastleDir,
  };
}

async function prepareEpicStart(
  epic: string,
  baseConfig: EpicSandcastleConfig,
  projectMap: ProjectMap,
): Promise<EpicContext> {
  return createEpicContext({ ...baseConfig, epic, projectMap });
}

async function prepareFirstEpicInChain(
  firstEpic: string,
  baseConfig: EpicSandcastleConfig,
  longRun: LongRunOrchestrationOptions,
  completedEpics: readonly string[],
  handoff: LongRunHandoffOptions,
): Promise<void> {
  const prior = priorCompletedEpic(
    firstEpic,
    completedEpics,
    longRun.epics,
    longRun.canonicalEpicSequence,
  );
  if (prior) {
    console.log(
      `  Resuming after GitHub-complete ${prior}: bootstrapping ${integrationBranchForEpic(firstEpic)}…`,
    );
    await bootstrapIntegrationBranchFromEpic(prior, firstEpic, handoff);
  }

  await installHostDependencies(baseConfig.repoRoot);
}

export async function runLongEpicOrchestration(
  baseConfig: EpicSandcastleConfig,
  longRun: LongRunOrchestrationOptions,
): Promise<LongRunOrchestrationResult> {
  validateEpicSequence(longRun.epics);

  let projectMap = await loadProjectMapFromGithub(
    longRun.canonicalEpicSequence ?? longRun.epics,
    longRun.epics,
  );

  const { toRun: epicsToRun, skipped: skippedEpics } = filterEpicsFromProjectMap(
    longRun.epics,
    projectMap,
  );

  printProjectMapReport(projectMap, {
    scopedEpics: longRun.epics,
    highlightEpics: epicsToRun[0] ? [epicsToRun[0]] : [],
  });

  if (skippedEpics.length > 0) {
    console.log(`Skipping GitHub-complete epic(s): ${skippedEpics.join(", ")}`);
  }

  if (epicsToRun.length === 0) {
    console.log("\nLong-run orchestration: all epics in this sequence are GitHub-complete.");
    const lastActive =
      [...longRun.epics].reverse().find((epic) => projectMap.completedEpics.includes(epic)) ??
      null;
    return {
      epicsRun: [],
      skippedEpics,
      completedEpics: projectMap.completedEpics.filter((epic) => longRun.epics.includes(epic)),
      stoppedAt: null,
      stopReason: null,
      finalIntegrationBranch: lastActive ? integrationBranchForEpic(lastActive) : null,
      projectMap,
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
  console.log("  Epic completion source: GitHub (no open ready-for-agent issues per epic label).");

  const handoff = handoffOptions(longRun, baseConfig);
  await prepareFirstEpicInChain(
    epicsToRun[0]!,
    baseConfig,
    longRun,
    projectMap.completedEpics,
    handoff,
  );

  const sessionCompleted: string[] = [];

  for (const [index, epic] of epicsToRun.entries()) {
    console.log(`\n${"=".repeat(72)}`);
    console.log(
      `EPIC ${index + 1}/${epicsToRun.length}: ${epic} (${integrationBranchForEpic(epic)})`,
    );
    console.log(`${"=".repeat(72)}\n`);

    const ctx =
      index === 0
        ? createEpicContext({ ...baseConfig, epic, projectMap })
        : await prepareEpicStart(epic, baseConfig, projectMap);

    const result = await runEpicLoop(ctx);

    if (!result.completed) {
      const pending = await listEpicPendingMergeIssues(ctx);
      const detail =
        result.reason === "pending-merges"
          ? `${pending.length} unmerged feature branch(es)`
          : `maxIterations (${baseConfig.maxIterations}) exhausted with agent work remaining`;

      console.error(`\nEpic ${epic} did not complete: ${detail}.`);
      console.error("  Stopping long-run sequence.");

      return {
        epicsRun: epicsToRun.slice(0, index + 1),
        skippedEpics,
        completedEpics: projectMap.completedEpics.filter((item) => longRun.epics.includes(item)),
        stoppedAt: epic,
        stopReason: result.reason,
        finalIntegrationBranch:
          sessionCompleted.length > 0
            ? integrationBranchForEpic(sessionCompleted[sessionCompleted.length - 1]!)
            : ctx.config.integrationBranch,
        projectMap,
      };
    }

    sessionCompleted.push(epic);
    const epicEntry = projectMap.epics.find((entry) => entry.epic === epic);
    if (epicEntry?.status === "has_work") {
      console.log(
        `\nEpic ${epic} agent queue idle; GitHub still has ${epicEntry.openReadyCount} open ready-for-agent issue(s).`,
      );
    } else {
      console.log(`\nEpic ${epic} agent queue idle; GitHub shows no remaining ready-for-agent work.`);
    }

    await pushIntegrationBranchIfEnabled(
      ctx.config.integrationBranch,
      handoffOptions(longRun, baseConfig),
      `\nPushing ${ctx.config.integrationBranch} (all issue merges landed)…`,
    );

    projectMap = await loadProjectMapFromGithub(
      longRun.canonicalEpicSequence ?? longRun.epics,
      longRun.epics,
    );

    const nextEpic = epicsToRun[index + 1];
    printProjectMapReport(projectMap, {
      scopedEpics: longRun.epics,
      highlightEpics: nextEpic ? [nextEpic] : [],
      title: `Sandcastle project state (GitHub) — after ${epic}`,
    });

    if (nextEpic) {
      const previousBranch = ctx.config.integrationBranch;
      const nextBranch = integrationBranchForEpic(nextEpic);
      console.log(`\n=== Handoff: ${nextBranch} from ${previousBranch} ===\n`);
      await bootstrapIntegrationBranchFromEpic(epic, nextEpic, handoff);
      await installHostDependencies(baseConfig.repoRoot);
    }
  }

  const finalIntegrationBranch =
    sessionCompleted.length > 0
      ? integrationBranchForEpic(sessionCompleted[sessionCompleted.length - 1]!)
      : null;

  console.log("\nLong-run orchestration finished.");
  console.log(`  Epics visited this session: ${sessionCompleted.join(", ") || "(none)"}`);
  console.log(
    `  GitHub-complete in scope: ${projectMap.completedEpics.filter((item) => longRun.epics.includes(item)).join(", ") || "(none)"}`,
  );
  if (finalIntegrationBranch) {
    console.log(
      `  All work is on ${finalIntegrationBranch}. Review and merge to main manually when ready.`,
    );
  }

  return {
    epicsRun: [...epicsToRun],
    skippedEpics,
    completedEpics: projectMap.completedEpics.filter((item) => longRun.epics.includes(item)),
    stoppedAt: null,
    stopReason: null,
    finalIntegrationBranch,
    projectMap,
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

export { filterEpicsFromProjectMap, loadProjectMapFromGithub, logProjectMapSummary };
export { printProjectMapReport, type ProjectMapReportOptions } from "./project-map-report.js";
