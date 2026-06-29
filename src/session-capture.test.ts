import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  aggregateTokenUsage,
  captureRunSessions,
  deriveDocRef,
  ensureTranscriptDirs,
  extractSessionDigests,
  extractSessionIds,
  transcriptChatsDirFor,
  transcriptClaudeProjectsDirFor,
  transcriptCodexSessionsDirFor,
  transcriptPiSessionsDirFor,
  transcriptsDirFor,
  withSessionCapture,
  type RunCaptureMeta,
} from "./session-capture.js";
import { runCaptureFor } from "./sandbox-agent.js";
import type { AgentHarness } from "./types.js";

const baseMeta: RunCaptureMeta = {
  role: "implementer",
  runName: "implement-171",
  epic: "aa4",
  harness: "claudeCode",
  model: "claude-opus-4-8-thinking-high",
  branch: "feature/aa4-171",
  issues: [{ id: "171", title: "[AA4] Add session digests", branch: "feature/aa4-171" }],
};

function readIndexRecords(sandcastleDir: string): unknown[] {
  const indexPath = path.join(transcriptsDirFor(sandcastleDir), "index.jsonl");
  return readFileSync(indexPath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

describe("session capture helpers", () => {
  test("deriveDocRef uses issue title tag when present", () => {
    expect(deriveDocRef(baseMeta)).toBe("aa4-171");
    expect(deriveDocRef({ epic: "aa4", issues: undefined })).toBe("aa4");
  });

  test("extractSessionDigests normalizes sandcastle iterations", () => {
    const digests = extractSessionDigests({
      iterations: [
        {
          sessionId: "sess-1",
          sessionFilePath: "/tmp/sess-1.jsonl",
          usage: {
            inputTokens: 100,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 50,
            outputTokens: 25,
          },
        },
        { sessionId: undefined, sessionFilePath: undefined },
      ],
    });

    expect(digests).toEqual([
      {
        sessionId: "sess-1",
        sessionFilePath: "/tmp/sess-1.jsonl",
        usage: {
          inputTokens: 100,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 50,
          outputTokens: 25,
          totalTokens: 175,
        },
      },
      { sessionId: null, sessionFilePath: null, usage: null },
    ]);
  });

  test("extractSessionIds deduplicates ids", () => {
    expect(
      extractSessionIds({
        iterations: [{ sessionId: "a" }, { sessionId: "a" }, { sessionId: "b" }],
      }),
    ).toEqual(["a", "b"]);
  });

  test("aggregateTokenUsage sums across iterations", () => {
    expect(
      aggregateTokenUsage({
        iterations: [
          {
            usage: {
              inputTokens: 10,
              cacheCreationInputTokens: 1,
              cacheReadInputTokens: 2,
              outputTokens: 3,
            },
          },
          {
            usage: {
              inputTokens: 5,
              cacheCreationInputTokens: 0,
              cacheReadInputTokens: 0,
              outputTokens: 7,
            },
          },
        ],
      }),
    ).toEqual({
      inputTokens: 15,
      cacheCreationInputTokens: 1,
      cacheReadInputTokens: 2,
      outputTokens: 10,
      totalTokens: 28,
    });
  });
});

describe("captureRunSessions", () => {
  const sandcastleDir = mkdtempSync(path.join(tmpdir(), "sandcastle-session-"));

  afterEach(() => {
    rmSync(transcriptsDirFor(sandcastleDir), { recursive: true, force: true });
  });

  test("writes a claude digest with token usage and confident match", () => {
    captureRunSessions(
      { config: { sandcastleDir } },
      baseMeta,
      {
        startedAtMs: 1_000,
        finishedAtMs: 2_000,
        status: "complete",
        result: {
          iterations: [
            {
              sessionId: "sess-claude",
              sessionFilePath: path.join(
                transcriptClaudeProjectsDirFor(sandcastleDir),
                "repo-sess-claude.jsonl",
              ),
              usage: {
                inputTokens: 1000,
                cacheCreationInputTokens: 0,
                cacheReadInputTokens: 0,
                outputTokens: 200,
              },
            },
          ],
        },
      },
    );

    const [record] = readIndexRecords(sandcastleDir) as Array<Record<string, unknown>>;
    expect(record.schemaVersion).toBe(2);
    expect(record.harness).toBe("claudeCode");
    expect(record.matchConfidence).toBe("confident");
    expect(record.tokens).toEqual({
      inputTokens: 1000,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      outputTokens: 200,
      totalTokens: 1200,
    });
    expect(record.enrichment).toMatchObject({
      status: "unavailable",
      source: "claudeCode-inline-usage",
    });
  });

  test("writes a codex digest from stream usage", () => {
    captureRunSessions(
      { config: { sandcastleDir } },
      { ...baseMeta, harness: "codex", model: "gpt-5.3-codex-high-fast" },
      {
        startedAtMs: 1_000,
        finishedAtMs: 2_000,
        status: "complete",
        result: {
          iterations: [
            {
              sessionId: "thread-1",
              sessionFilePath: path.join(transcriptCodexSessionsDirFor(sandcastleDir), "rollout.jsonl"),
              usage: {
                inputTokens: 500,
                cacheCreationInputTokens: 0,
                cacheReadInputTokens: 100,
                outputTokens: 50,
              },
            },
          ],
        },
      },
    );

    const [record] = readIndexRecords(sandcastleDir) as Array<Record<string, unknown>>;
    expect(record.harness).toBe("codex");
    expect((record.tokens as { totalTokens: number }).totalTokens).toBe(650);
  });

  test("writes an opencode digest with id-only confidence when no files are captured", () => {
    captureRunSessions(
      { config: { sandcastleDir } },
      { ...baseMeta, harness: "opencode", model: "zai/glm-5.2" },
      {
        startedAtMs: 1_000,
        finishedAtMs: 2_000,
        status: "complete",
        result: {
          iterations: [{ sessionId: "opencode-session-1" }],
        },
      },
    );

    const [record] = readIndexRecords(sandcastleDir) as Array<Record<string, unknown>>;
    expect(record.harness).toBe("opencode");
    expect(record.matchConfidence).toBe("id-only");
    expect(record.tokens).toBeNull();
    expect(record.enrichment).toMatchObject({ status: "unavailable" });
  });

  test("correlates cursor chats by time window when stream ids are missing", () => {
    const chatsDir = transcriptChatsDirFor(sandcastleDir);
    const sessionDir = path.join(chatsDir, "abc123", "cursor-session");
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(
      path.join(sessionDir, "meta.json"),
      JSON.stringify({ createdAtMs: 1_500 }),
      "utf8",
    );

    captureRunSessions(
      { config: { sandcastleDir } },
      { ...baseMeta, harness: "cursor", model: "auto" },
      {
        startedAtMs: 1_000,
        finishedAtMs: 2_000,
        status: "complete",
        result: { iterations: [{ sessionId: undefined }] },
      },
    );

    const [record] = readIndexRecords(sandcastleDir) as Array<Record<string, unknown>>;
    expect(record.harness).toBe("cursor");
    expect(record.matchConfidence).toBe("window-correlated");
    expect(record.candidateSessionIds).toEqual([
      { sessionId: "cursor-session", dir: "abc123/cursor-session", createdAtMs: 1500 },
    ]);
    expect(record.enrichment).toMatchObject({
      status: "pending",
      source: "cursor-dashboard-usage-events",
    });
  });

  test("records failed runs", () => {
    captureRunSessions(
      { config: { sandcastleDir } },
      { ...baseMeta, harness: "pi", model: "gemini-3.1-pro" },
      {
        startedAtMs: 1_000,
        finishedAtMs: 2_000,
        status: "failed",
        result: undefined,
      },
    );

    const [record] = readIndexRecords(sandcastleDir) as Array<Record<string, unknown>>;
    expect(record.status).toBe("failed");
    expect(record.harness).toBe("pi");
  });
});

describe("withSessionCapture", () => {
  const sandcastleDir = mkdtempSync(path.join(tmpdir(), "sandcastle-wrap-"));

  afterEach(() => {
    rmSync(transcriptsDirFor(sandcastleDir), { recursive: true, force: true });
  });

  test("returns the run result and appends a digest on success", async () => {
    const result = await withSessionCapture(
      { config: { sandcastleDir } },
      { ...baseMeta, harness: "copilot", model: "gpt-5.5-medium" },
      async () => ({ iterations: [{ sessionId: "copilot-1" }] }),
    );

    expect(result).toEqual({ iterations: [{ sessionId: "copilot-1" }] });
    const [record] = readIndexRecords(sandcastleDir) as Array<Record<string, unknown>>;
    expect(record.status).toBe("complete");
    expect(record.harness).toBe("copilot");
  });

  test("records failed runs then rethrows", async () => {
    await expect(
      withSessionCapture(
        { config: { sandcastleDir } },
        baseMeta,
        async () => {
          throw new Error("agent failed");
        },
      ),
    ).rejects.toThrow("agent failed");

    const [record] = readIndexRecords(sandcastleDir) as Array<Record<string, unknown>>;
    expect(record.status).toBe("failed");
  });
});

describe("runCaptureFor", () => {
  test("fills harness and model from epic config", () => {
    const capture = runCaptureFor(
      {
        config: {
          sandcastleDir: "/repo/.sandcastle",
          epic: "aa4",
          agents: {
            planner: { harness: "cursor", model: "auto" },
            implementer: { harness: "opencode", model: "zai/glm-5.2" },
            reviewer: { harness: "claudeCode", model: "claude-opus-4-8-thinking-high" },
            resolver: { harness: "codex", model: "gpt-5.3-codex-high-fast" },
            merger: { harness: "pi", model: "gemini-3.1-pro" },
            supervisor: { harness: "copilot", model: "gpt-5.5-medium" },
          },
        },
      },
      "reviewer",
      { runName: "review-171", branch: "feature/aa4-171" },
    );

    expect(capture.meta).toMatchObject({
      role: "reviewer",
      epic: "aa4",
      harness: "claudeCode",
      model: "claude-opus-4-8-thinking-high",
      runName: "review-171",
    });
  });
});

describe("ensureTranscriptDirs", () => {
  test("creates all harness transcript directories", () => {
    const sandcastleDir = mkdtempSync(path.join(tmpdir(), "sandcastle-dirs-"));
    ensureTranscriptDirs(sandcastleDir);

    for (const dirFor of [
      transcriptChatsDirFor,
      transcriptClaudeProjectsDirFor,
      transcriptCodexSessionsDirFor,
      transcriptPiSessionsDirFor,
    ]) {
      expect(dirFor(sandcastleDir)).toBeTruthy();
    }

    rmSync(sandcastleDir, { recursive: true, force: true });
  });
});

describe("harness evaluation matrix", () => {
  const harnesses: AgentHarness[] = [
    "cursor",
    "codex",
    "claudeCode",
    "pi",
    "opencode",
    "copilot",
  ];

  test.each(harnesses)("captures a digest row for %s", (harness) => {
    const sandcastleDir = mkdtempSync(path.join(tmpdir(), `sandcastle-${harness}-`));
    try {
      captureRunSessions(
        { config: { sandcastleDir } },
        { ...baseMeta, harness, model: "auto" },
        {
          startedAtMs: 1_000,
          finishedAtMs: 2_000,
          status: "complete",
          result: {
            iterations: [{ sessionId: `${harness}-session`, sessionFilePath: harness === "cursor" || harness === "opencode" || harness === "copilot" ? undefined : `/tmp/${harness}.jsonl` }],
          },
        },
      );

      const [record] = readIndexRecords(sandcastleDir) as Array<Record<string, unknown>>;
      expect(record.harness).toBe(harness);
      expect(record.sessions).toHaveLength(1);
    } finally {
      rmSync(sandcastleDir, { recursive: true, force: true });
    }
  });
});
