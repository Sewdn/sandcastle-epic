/** Default max concurrent implementer clusters (each cluster = sandbox + agents). */
export const DEFAULT_PARALLEL_CLUSTER_LIMIT = 2;

function parsePositiveIntEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim().length === 0) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function parseDisabledFlag(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === "0" || normalized === "false" || normalized === "off";
}

export type ParallelClusterConfig = {
  readonly enabled: boolean;
  readonly limit: number;
};

/** Resolve parallel cluster settings from the environment. */
export function resolveParallelClusterConfig(
  env: NodeJS.ProcessEnv = process.env,
): ParallelClusterConfig {
  const enabled = !parseDisabledFlag(env.SANDCASTLE_PARALLEL_CLUSTERS);
  const limit = parsePositiveIntEnv(
    env.SANDCASTLE_PARALLEL_CLUSTER_LIMIT,
    DEFAULT_PARALLEL_CLUSTER_LIMIT,
  );

  return {
    enabled,
    limit: enabled ? limit : 1,
  };
}

/** Run async work over items with at most `limit` concurrent executions. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  if (items.length === 0) {
    return [];
  }

  const concurrency = Math.max(1, Math.min(limit, items.length));
  const results: PromiseSettledResult<R>[] = Array.from({ length: items.length });
  let nextIndex = 0;

  const worker = async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) {
        return;
      }

      try {
        const value = await fn(items[index]!, index);
        results[index] = { status: "fulfilled", value };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}
