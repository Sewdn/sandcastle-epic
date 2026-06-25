import { describe, expect, test } from "bun:test";
import {
  DEFAULT_PARALLEL_CLUSTER_LIMIT,
  mapWithConcurrency,
  resolveParallelClusterConfig,
} from "./parallel.js";

describe("resolveParallelClusterConfig", () => {
  test("defaults to enabled with limit 2", () => {
    expect(resolveParallelClusterConfig({})).toEqual({
      enabled: true,
      limit: DEFAULT_PARALLEL_CLUSTER_LIMIT,
    });
  });

  test("disables parallel clusters when flag is off", () => {
    expect(resolveParallelClusterConfig({ SANDCASTLE_PARALLEL_CLUSTERS: "0" })).toEqual({
      enabled: false,
      limit: 1,
    });
  });

  test("respects SANDCASTLE_PARALLEL_CLUSTER_LIMIT", () => {
    expect(
      resolveParallelClusterConfig({
        SANDCASTLE_PARALLEL_CLUSTER_LIMIT: "3",
      }),
    ).toEqual({
      enabled: true,
      limit: 3,
    });
  });

  test("limit 1 keeps parallel enabled but serializes work", () => {
    expect(
      resolveParallelClusterConfig({
        SANDCASTLE_PARALLEL_CLUSTER_LIMIT: "1",
      }),
    ).toEqual({
      enabled: true,
      limit: 1,
    });
  });
});

describe("mapWithConcurrency", () => {
  test("runs all items when limit exceeds item count", async () => {
    const seen: number[] = [];
    const results = await mapWithConcurrency([1, 2, 3], 5, async (value) => {
      seen.push(value);
      return value * 2;
    });

    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3]);
    expect(results).toEqual([
      { status: "fulfilled", value: 2 },
      { status: "fulfilled", value: 4 },
      { status: "fulfilled", value: 6 },
    ]);
  });

  test("caps in-flight work at the concurrency limit", async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    await mapWithConcurrency([0, 1, 2, 3, 4], 2, async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 20));
      inFlight -= 1;
      return true;
    });

    expect(maxInFlight).toBeLessThanOrEqual(2);
    expect(maxInFlight).toBe(2);
  });

  test("captures rejections without stopping other tasks", async () => {
    const results = await mapWithConcurrency([1, 2, 3], 2, async (value) => {
      if (value === 2) {
        throw new Error("boom");
      }
      return value;
    });

    expect(results[0]).toEqual({ status: "fulfilled", value: 1 });
    expect(results[1]?.status).toBe("rejected");
    expect(results[2]).toEqual({ status: "fulfilled", value: 3 });
  });
});
