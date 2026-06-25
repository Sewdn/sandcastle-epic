import { describe, expect, test } from "bun:test";
import {
  isTransientAgentFailure,
  resolveTransientAgentRetryConfig,
  runWithTransientRetries,
} from "./agent-retry.js";

describe("isTransientAgentFailure", () => {
  test("matches Cursor HTTP 502 unavailable errors", () => {
    expect(
      isTransientAgentFailure(
        new Error('cursor exited with code 1:\nError: [unavailable] HTTP 502'),
      ),
    ).toBe(true);
  });

  test("rejects non-transient agent failures", () => {
    expect(isTransientAgentFailure(new Error("cursor exited with code 1: auth failed"))).toBe(
      false,
    );
  });

  test("rejects billing blockers", () => {
    expect(
      isTransientAgentFailure(
        new Error(
          "ActionRequiredError: You have an unpaid invoice Visit cursor.com/dashboard and pay your invoice",
        ),
      ),
    ).toBe(false);
  });
});

describe("runWithTransientRetries", () => {
  test("retries transient failures with exponential backoff", async () => {
    let attempts = 0;
    const sleeps: number[] = [];
    const originalSetTimeout = globalThis.setTimeout;

    globalThis.setTimeout = ((handler: (...args: unknown[]) => void, ms?: number) => {
      sleeps.push(ms ?? 0);
      if (typeof handler === "function") {
        handler();
      }
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout;

    try {
      const result = await runWithTransientRetries(
        "test run",
        async () => {
          attempts += 1;
          if (attempts < 3) {
            throw new Error("[unavailable] HTTP 502");
          }
          return "ok";
        },
        { maxRetries: 2, baseBackoffMs: 1000 },
      );

      expect(result).toBe("ok");
      expect(attempts).toBe(3);
      expect(sleeps).toEqual([1000, 2000]);
    } finally {
      globalThis.setTimeout = originalSetTimeout;
    }
  });

  test("does not retry permanent failures", async () => {
    let attempts = 0;
    await expect(
      runWithTransientRetries(
        "test run",
        async () => {
          attempts += 1;
          throw new Error("syntax error in prompt");
        },
        { maxRetries: 3, baseBackoffMs: 10 },
      ),
    ).rejects.toThrow("syntax error");

    expect(attempts).toBe(1);
  });
});

describe("resolveTransientAgentRetryConfig", () => {
  test("reads retry settings from env", () => {
    expect(
      resolveTransientAgentRetryConfig({
        SANDCASTLE_AGENT_TRANSIENT_RETRIES: "4",
        SANDCASTLE_AGENT_TRANSIENT_BACKOFF_MS: "2500",
      }),
    ).toEqual({ maxRetries: 4, baseBackoffMs: 2500 });
  });
});
