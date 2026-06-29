import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentHarness, AgentRole } from "./types.js";

const TRANSCRIPTS_DIRNAME = "transcripts";
const CHATS_DIRNAME = "chats";
const CLAUDE_PROJECTS_DIRNAME = path.join("claude", "projects");
const CODEX_SESSIONS_DIRNAME = path.join("codex", "sessions");
const PI_SESSIONS_DIRNAME = path.join("pi", "agent", "sessions");
const INDEX_FILENAME = "index.jsonl";
const RECORD_SCHEMA_VERSION = 2;

/**
 * Grace window (ms) added on either side of a run when correlating Cursor
 * transcript folders to that run by their `meta.json` creation time.
 */
const CANDIDATE_WINDOW_GRACE_MS = 10_000;

/** Root for captured transcript artifacts: `<sandcastleDir>/transcripts`. */
export function transcriptsDirFor(sandcastleDir: string): string {
  return path.join(sandcastleDir, TRANSCRIPTS_DIRNAME);
}

/** Host dir bind-mounted to the sandbox's `~/.cursor/chats`. */
export function transcriptChatsDirFor(sandcastleDir: string): string {
  return path.join(transcriptsDirFor(sandcastleDir), CHATS_DIRNAME);
}

/** Host dir bind-mounted to the sandbox's `~/.claude/projects`. */
export function transcriptClaudeProjectsDirFor(sandcastleDir: string): string {
  return path.join(transcriptsDirFor(sandcastleDir), CLAUDE_PROJECTS_DIRNAME);
}

/** Host dir bind-mounted to the sandbox's `~/.codex/sessions`. */
export function transcriptCodexSessionsDirFor(sandcastleDir: string): string {
  return path.join(transcriptsDirFor(sandcastleDir), CODEX_SESSIONS_DIRNAME);
}

/** Host dir bind-mounted to the sandbox's `~/.pi/agent/sessions`. */
export function transcriptPiSessionsDirFor(sandcastleDir: string): string {
  return path.join(transcriptsDirFor(sandcastleDir), PI_SESSIONS_DIRNAME);
}

function indexPathFor(sandcastleDir: string): string {
  return path.join(transcriptsDirFor(sandcastleDir), INDEX_FILENAME);
}

/** Minimal structural context — satisfied by `EpicContext`. */
export type SessionCaptureCtx = {
  readonly config: { readonly sandcastleDir: string };
};

export interface RunCaptureMeta {
  readonly role: AgentRole;
  readonly runName: string;
  readonly epic: string;
  readonly harness: AgentHarness;
  readonly model: string;
  readonly branch?: string;
  readonly issues?: ReadonlyArray<{
    readonly id: string;
    readonly title: string;
    readonly branch: string;
  }>;
}

export interface RunTiming {
  readonly startedAtMs: number;
  readonly finishedAtMs: number;
  readonly status: "complete" | "failed";
  /** Sandcastle run result; `iterations[]` carries session ids, paths, and usage. */
  readonly result?: unknown;
}

/** Per-iteration session snapshot written into each run digest. */
export interface SessionDigestEntry {
  readonly sessionId: string | null;
  readonly sessionFilePath: string | null;
  readonly usage: TokenUsageSnapshot | null;
}

/** Aggregated token counts for a run (summed across iterations when present). */
export interface TokenUsageSnapshot {
  readonly inputTokens: number;
  readonly cacheCreationInputTokens: number;
  readonly cacheReadInputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
}

interface TranscriptCandidate {
  readonly sessionId: string;
  /** Path relative to the chats dir: `<cwdHash>/<sessionId>`. */
  readonly dir: string;
  readonly createdAtMs: number;
}

type MatchConfidence =
  | "confident"
  | "id-only"
  | "window-correlated"
  | "ambiguous"
  | "none";

interface CursorAuthInfo {
  readonly userId?: number;
  readonly email?: string;
}

type SandcastleIteration = {
  readonly sessionId?: unknown;
  readonly sessionFilePath?: unknown;
  readonly usage?: {
    readonly inputTokens?: unknown;
    readonly cacheCreationInputTokens?: unknown;
    readonly cacheReadInputTokens?: unknown;
    readonly outputTokens?: unknown;
  };
};

type SandcastleRunResult = {
  readonly iterations?: ReadonlyArray<SandcastleIteration>;
};

interface CostEnrichment {
  readonly status: "complete" | "pending" | "unavailable";
  readonly source: string;
  readonly join?: string;
  readonly note?: string;
}

let cachedAuth: CursorAuthInfo | null | undefined;

function readCursorAuthInfo(): CursorAuthInfo | null {
  if (cachedAuth !== undefined) return cachedAuth;
  try {
    const configPath = path.join(os.homedir(), ".cursor", "cli-config.json");
    const raw = JSON.parse(readFileSync(configPath, "utf8")) as {
      authInfo?: { userId?: number; email?: string };
    };
    cachedAuth = { userId: raw.authInfo?.userId, email: raw.authInfo?.email };
  } catch {
    cachedAuth = null;
  }
  return cachedAuth;
}

function listCursorTranscriptCandidates(sandcastleDir: string): TranscriptCandidate[] {
  const chatsDir = transcriptChatsDirFor(sandcastleDir);
  if (!existsSync(chatsDir)) return [];

  const candidates: TranscriptCandidate[] = [];
  let hashDirs: string[];
  try {
    hashDirs = readdirSync(chatsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }

  for (const hash of hashDirs) {
    let sessionDirs: string[];
    try {
      sessionDirs = readdirSync(path.join(chatsDir, hash), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch {
      continue;
    }

    for (const sessionId of sessionDirs) {
      const metaPath = path.join(chatsDir, hash, sessionId, "meta.json");
      let createdAtMs = 0;
      try {
        const meta = JSON.parse(readFileSync(metaPath, "utf8")) as {
          createdAtMs?: number;
        };
        if (typeof meta.createdAtMs === "number") createdAtMs = meta.createdAtMs;
      } catch {
        // meta.json missing/unreadable — keep as a weak candidate.
      }
      candidates.push({ sessionId, dir: path.join(hash, sessionId), createdAtMs });
    }
  }

  return candidates;
}

function asSandcastleRunResult(result: unknown): SandcastleRunResult | null {
  if (!result || typeof result !== "object") return null;
  const iterations = (result as SandcastleRunResult).iterations;
  if (iterations !== undefined && !Array.isArray(iterations)) return null;
  return result as SandcastleRunResult;
}

function normalizeUsage(usage: SandcastleIteration["usage"]): TokenUsageSnapshot | null {
  if (!usage) return null;
  const inputTokens = typeof usage.inputTokens === "number" ? usage.inputTokens : 0;
  const cacheCreationInputTokens =
    typeof usage.cacheCreationInputTokens === "number" ? usage.cacheCreationInputTokens : 0;
  const cacheReadInputTokens =
    typeof usage.cacheReadInputTokens === "number" ? usage.cacheReadInputTokens : 0;
  const outputTokens = typeof usage.outputTokens === "number" ? usage.outputTokens : 0;
  const totalTokens =
    inputTokens + cacheCreationInputTokens + cacheReadInputTokens + outputTokens;
  if (totalTokens === 0) return null;
  return {
    inputTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens,
    outputTokens,
    totalTokens,
  };
}

/** Build per-iteration session digests from a Sandcastle run result. */
export function extractSessionDigests(result: unknown): SessionDigestEntry[] {
  const run = asSandcastleRunResult(result);
  if (!run?.iterations?.length) return [];

  return run.iterations.map((iteration) => ({
    sessionId:
      typeof iteration.sessionId === "string" && iteration.sessionId.length > 0
        ? iteration.sessionId
        : null,
    sessionFilePath:
      typeof iteration.sessionFilePath === "string" && iteration.sessionFilePath.length > 0
        ? iteration.sessionFilePath
        : null,
    usage: normalizeUsage(iteration.usage),
  }));
}

export function extractSessionIds(result: unknown): string[] {
  const ids = extractSessionDigests(result)
    .map((digest) => digest.sessionId)
    .filter((id): id is string => id !== null);
  return [...new Set(ids)];
}

/** Sum token usage across all iterations that reported usage. */
export function aggregateTokenUsage(result: unknown): TokenUsageSnapshot | null {
  const digests = extractSessionDigests(result);
  let inputTokens = 0;
  let cacheCreationInputTokens = 0;
  let cacheReadInputTokens = 0;
  let outputTokens = 0;
  let sawUsage = false;

  for (const digest of digests) {
    if (!digest.usage) continue;
    sawUsage = true;
    inputTokens += digest.usage.inputTokens;
    cacheCreationInputTokens += digest.usage.cacheCreationInputTokens;
    cacheReadInputTokens += digest.usage.cacheReadInputTokens;
    outputTokens += digest.usage.outputTokens;
  }

  if (!sawUsage) return null;
  return {
    inputTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens,
    outputTokens,
    totalTokens: inputTokens + cacheCreationInputTokens + cacheReadInputTokens + outputTokens,
  };
}

/** Derive a docs reference (e.g. `aa4-167`) from the primary issue's `[TAG]` prefix. */
export function deriveDocRef(meta: Pick<RunCaptureMeta, "epic" | "issues">): string {
  const primary = meta.issues?.[0];
  const titleTag = primary?.title.match(/^\s*\[([^\]]+)\]/)?.[1];
  const base = (titleTag ?? meta.epic)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return primary ? `${base}-${primary.id}` : base;
}

function classifyConfidence(
  harness: AgentHarness,
  sessionIds: readonly string[],
  digests: readonly SessionDigestEntry[],
  windowCandidates: readonly TranscriptCandidate[],
): MatchConfidence {
  const hasCapturedFiles = digests.some((digest) => digest.sessionFilePath !== null);
  if (hasCapturedFiles) return "confident";

  const candidateIds = new Set(windowCandidates.map((candidate) => candidate.sessionId));
  if (sessionIds.some((id) => candidateIds.has(id))) return "confident";
  if (sessionIds.length > 0) return "id-only";

  if (harness === "cursor") {
    if (windowCandidates.length === 1) return "window-correlated";
    if (windowCandidates.length > 1) return "ambiguous";
  }

  return "none";
}

function costEnrichmentFor(
  harness: AgentHarness,
  tokens: TokenUsageSnapshot | null,
): { readonly costCents: number | null; readonly enrichment: CostEnrichment } {
  if (harness === "cursor") {
    return {
      costCents: null,
      enrichment: {
        status: "pending",
        source: "cursor-dashboard-usage-events",
        join: "userId+isHeadless+window",
        note: "Token counts may be filled by a deferred dashboard join; inline Cursor usage is not streamed.",
      },
    };
  }

  if (tokens) {
    return {
      costCents: null,
      enrichment: {
        status: "unavailable",
        source: `${harness}-inline-usage`,
        note: "Token usage captured from the agent stream; dollar cost is not reported by this harness.",
      },
    };
  }

  return {
    costCents: null,
    enrichment: {
      status: "unavailable",
      source: `${harness}-usage`,
      note: "This harness did not report token usage for this run.",
    },
  };
}

/**
 * Append one run digest to `<transcripts>/index.jsonl`. Best-effort: any failure
 * is swallowed so transcript bookkeeping never breaks an agent run.
 */
export function captureRunSessions(
  ctx: SessionCaptureCtx,
  meta: RunCaptureMeta,
  timing: RunTiming,
): void {
  try {
    const { sandcastleDir } = ctx.config;
    const digests = extractSessionDigests(timing.result);
    const sessionIds = extractSessionIds(timing.result);
    const tokens = aggregateTokenUsage(timing.result);
    const { costCents, enrichment } = costEnrichmentFor(meta.harness, tokens);

    const windowCandidates =
      meta.harness === "cursor"
        ? listCursorTranscriptCandidates(sandcastleDir).filter(
            (candidate) =>
              candidate.createdAtMs >= timing.startedAtMs - CANDIDATE_WINDOW_GRACE_MS &&
              candidate.createdAtMs <= timing.finishedAtMs + CANDIDATE_WINDOW_GRACE_MS,
          )
        : [];

    const auth = meta.harness === "cursor" ? readCursorAuthInfo() : null;

    const record = {
      schemaVersion: RECORD_SCHEMA_VERSION,
      recordedAtMs: Date.now(),
      epic: meta.epic,
      role: meta.role,
      runName: meta.runName,
      harness: meta.harness,
      model: meta.model,
      branch: meta.branch ?? null,
      issueIds: meta.issues?.map((issue) => issue.id) ?? [],
      issueTitles: meta.issues?.map((issue) => issue.title) ?? [],
      docRef: deriveDocRef(meta),
      sessions: digests,
      sessionIds,
      candidateSessionIds: windowCandidates,
      matchConfidence: classifyConfidence(meta.harness, sessionIds, digests, windowCandidates),
      startedAtMs: timing.startedAtMs,
      finishedAtMs: timing.finishedAtMs,
      status: timing.status,
      userId: auth?.userId ?? null,
      userEmail: auth?.email ?? null,
      tokens,
      costCents,
      enrichment,
    };

    const indexPath = indexPathFor(sandcastleDir);
    mkdirSync(path.dirname(indexPath), { recursive: true });
    appendFileSync(indexPath, `${JSON.stringify(record)}\n`, "utf8");
  } catch {
    // Best-effort: capture must never break a run.
  }
}

/**
 * Time a run and record a session digest once it settles. Returns the run's
 * result unchanged, so callers are otherwise unaffected.
 */
export async function withSessionCapture<T>(
  ctx: SessionCaptureCtx,
  meta: RunCaptureMeta,
  fn: () => Promise<T>,
): Promise<T> {
  const startedAtMs = Date.now();
  let result: T | undefined;
  let status: "complete" | "failed" = "complete";
  try {
    result = await fn();
    return result;
  } catch (error) {
    status = "failed";
    throw error;
  } finally {
    captureRunSessions(ctx, meta, {
      startedAtMs,
      finishedAtMs: Date.now(),
      status,
      result,
    });
  }
}

/** Ensure all harness transcript host dirs exist before sandbox mounts are checked. */
export function ensureTranscriptDirs(sandcastleDir: string): void {
  for (const dir of [
    transcriptChatsDirFor,
    transcriptClaudeProjectsDirFor,
    transcriptCodexSessionsDirFor,
    transcriptPiSessionsDirFor,
  ]) {
    mkdirSync(dir(sandcastleDir), { recursive: true });
  }
}
