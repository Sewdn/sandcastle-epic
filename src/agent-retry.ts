/** Retries for transient Cursor/provider failures inside an existing agent sandbox run. */

export type TransientAgentRetryConfig = {
  readonly maxRetries: number;
  readonly baseBackoffMs: number;
};

function parseNonNegativeIntEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim().length === 0) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function parsePositiveIntEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim().length === 0) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

/** Env: SANDCASTLE_AGENT_TRANSIENT_RETRIES (default 2), SANDCASTLE_AGENT_TRANSIENT_BACKOFF_MS (default 5000). */
export function resolveTransientAgentRetryConfig(
  env: NodeJS.ProcessEnv = process.env,
): TransientAgentRetryConfig {
  return {
    maxRetries: parseNonNegativeIntEnv(env.SANDCASTLE_AGENT_TRANSIENT_RETRIES, 2),
    baseBackoffMs: parsePositiveIntEnv(env.SANDCASTLE_AGENT_TRANSIENT_BACKOFF_MS, 5000),
  };
}

const TRANSIENT_AGENT_PATTERNS = [
  /HTTP 502/i,
  /\[unavailable\]/i,
  /\b503\b/i,
  /\b429\b/i,
  /rate limit/i,
  /bad gateway/i,
  /service unavailable/i,
];

const NON_TRANSIENT_AGENT_PATTERNS = [
  /ActionRequiredError/i,
  /unpaid invoice/i,
  /pay your invoice/i,
];

export function formatAgentError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/** True when the agent harness failed due to a likely-transient provider/network error. */
export function isTransientAgentFailure(error: unknown): boolean {
  const message = formatAgentError(error);
  if (NON_TRANSIENT_AGENT_PATTERNS.some((pattern) => pattern.test(message))) {
    return false;
  }
  return TRANSIENT_AGENT_PATTERNS.some((pattern) => pattern.test(message));
}

function backoffMs(config: TransientAgentRetryConfig, attempt: number): number {
  return config.baseBackoffMs * 2 ** (attempt - 1);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** Re-run `run` on transient agent failures without tearing down the sandbox. */
export async function runWithTransientRetries<T>(
  label: string,
  run: () => Promise<T>,
  config: TransientAgentRetryConfig = resolveTransientAgentRetryConfig(),
): Promise<T> {
  const maxAttempts = config.maxRetries + 1;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      const transient = isTransientAgentFailure(error);
      const hasRetryLeft = attempt < maxAttempts;

      if (!transient || !hasRetryLeft) {
        throw error;
      }

      const delayMs = backoffMs(config, attempt);
      const summary = formatAgentError(error).split("\n")[0]?.trim() ?? "unknown error";
      console.warn(
        `  ${label}: transient agent failure (attempt ${attempt}/${maxAttempts}) — retrying in ${delayMs}ms…`,
      );
      console.warn(`    ${summary}`);
      await sleep(delayMs);
    }
  }

  throw lastError;
}
