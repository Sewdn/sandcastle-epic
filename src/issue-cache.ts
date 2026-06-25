import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadMergedIssueBacklog } from "./backlog.js";
import { fetchOpenReadyForAgentIssues, type OpenReadyIssue } from "./project-map.js";

export const ISSUE_CACHE_VERSION = 1 as const;
export const ISSUE_CACHE_DIR = "cache";
export const ISSUE_CACHE_FILENAME = "cachemap.json";

export type IssueDependencyCacheEntry = {
  readonly id: string;
  readonly localId: string;
  readonly epic: string;
  readonly title: string;
  readonly parallel: boolean;
  readonly blockedByLocalIds: readonly string[];
  readonly blockedByEpicsOnMain: readonly string[];
  readonly openBlockerIds: readonly string[];
};

export type IssueDependencyCacheMap = {
  readonly version: typeof ISSUE_CACHE_VERSION;
  readonly backlogFingerprint: string;
  readonly githubFetchedAt: string;
  readonly openReadyForAgent: readonly OpenReadyIssue[];
  readonly issueDependencies: Readonly<Record<string, IssueDependencyCacheEntry>>;
};

export type IssueCacheOptions = {
  readonly sandcastleDir?: string;
  readonly forceRefresh?: boolean;
  readonly ttlMs?: number;
};

export function issueCacheDir(sandcastleDir: string): string {
  return path.join(sandcastleDir, ISSUE_CACHE_DIR);
}

export function issueCacheMapPath(sandcastleDir: string): string {
  return path.join(issueCacheDir(sandcastleDir), ISSUE_CACHE_FILENAME);
}

/** Fingerprint of backlog dependency fields — invalidates cache when YAML blockers change. */
export function backlogDependencyFingerprint(repoRoot: string): string {
  const backlog = loadMergedIssueBacklog(repoRoot);
  const payload = backlog.issues.map((issue) => ({
    local_id: issue.local_id,
    github: issue.github,
    epic: issue.epic,
    parallel: issue.parallel ?? false,
    blocked_by_issues: issue.blocked_by_issues ?? [],
    blocked_by_epics_on_main: issue.blocked_by_epics_on_main ?? [],
  }));

  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 16);
}

export function resolveIssueCacheOptions(env: {
  sandcastleDir?: string;
  refreshCache?: string;
  issueCacheTtlMs?: string;
}): IssueCacheOptions {
  const ttlRaw = env.issueCacheTtlMs?.trim();
  const ttlMs = ttlRaw ? Number(ttlRaw) : 0;

  return {
    sandcastleDir: env.sandcastleDir,
    forceRefresh:
      env.refreshCache === "1" || env.refreshCache?.toLowerCase() === "true",
    ttlMs: Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : undefined,
  };
}

export function issueCacheOptionsFromEnv(sandcastleDir: string): IssueCacheOptions {
  return resolveIssueCacheOptions({
    sandcastleDir,
    refreshCache: process.env.SANDCASTLE_REFRESH_CACHE,
    issueCacheTtlMs: process.env.SANDCASTLE_ISSUE_CACHE_TTL_MS,
  });
}

export function loadIssueDependencyCacheMap(
  sandcastleDir: string,
): IssueDependencyCacheMap | null {
  try {
    const raw = readFileSync(issueCacheMapPath(sandcastleDir), "utf8");
    const parsed = JSON.parse(raw) as IssueDependencyCacheMap;
    if (parsed.version !== ISSUE_CACHE_VERSION) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveIssueDependencyCacheMap(
  sandcastleDir: string,
  cache: IssueDependencyCacheMap,
): void {
  const dir = issueCacheDir(sandcastleDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(issueCacheMapPath(sandcastleDir), `${JSON.stringify(cache, null, 2)}\n`, "utf8");
}

function openIssueIdsKey(issues: readonly OpenReadyIssue[]): string {
  return [...issues.map((issue) => issue.id)].sort((left, right) => Number(left) - Number(right)).join(",");
}

export function isIssueDependencyCacheValid(
  cache: IssueDependencyCacheMap,
  backlogFingerprint: string,
  options: IssueCacheOptions = {},
): boolean {
  if (options.forceRefresh) {
    return false;
  }
  if (cache.backlogFingerprint !== backlogFingerprint) {
    return false;
  }
  if (options.ttlMs !== undefined) {
    const age = Date.now() - new Date(cache.githubFetchedAt).getTime();
    if (!Number.isFinite(age) || age > options.ttlMs) {
      return false;
    }
  }
  return cache.openReadyForAgent.length > 0;
}

export function openIssueSetsMatch(
  cached: readonly OpenReadyIssue[],
  current: readonly OpenReadyIssue[],
): boolean {
  return openIssueIdsKey(cached) === openIssueIdsKey(current);
}

export type OpenReadyIssueLoadResult = {
  readonly issues: readonly OpenReadyIssue[];
  readonly fromCache: boolean;
  readonly cache: IssueDependencyCacheMap | null;
  readonly backlogFingerprint: string;
};

/** Read cache first; fall back to GitHub `ready-for-agent` list when stale or missing. */
export async function loadOpenReadyForAgentIssues(
  repoRoot: string,
  options: IssueCacheOptions = {},
): Promise<OpenReadyIssueLoadResult> {
  const backlogFingerprint = backlogDependencyFingerprint(repoRoot);
  const sandcastleDir = options.sandcastleDir;

  if (sandcastleDir) {
    const cache = loadIssueDependencyCacheMap(sandcastleDir);
    if (cache && isIssueDependencyCacheValid(cache, backlogFingerprint, options)) {
      console.log(
        `  Using cached GitHub issue list (${ISSUE_CACHE_DIR}/${ISSUE_CACHE_FILENAME}, ${cache.openReadyForAgent.length} issue(s))…`,
      );
      return {
        issues: cache.openReadyForAgent,
        fromCache: true,
        cache,
        backlogFingerprint,
      };
    }
  }

  const issues = await fetchOpenReadyForAgentIssues();
  return {
    issues,
    fromCache: false,
    cache: sandcastleDir ? loadIssueDependencyCacheMap(sandcastleDir) : null,
    backlogFingerprint,
  };
}

export function dependencyCacheEntryForIssue(issue: {
  readonly id: string;
  readonly localId: string;
  readonly epic: string;
  readonly title: string;
  readonly parallel: boolean;
  readonly blockedByLocalIds: readonly string[];
  readonly blockedByEpicsOnMain: readonly string[];
  readonly openBlockerIds: readonly string[];
}): IssueDependencyCacheEntry {
  return {
    id: issue.id,
    localId: issue.localId,
    epic: issue.epic,
    title: issue.title,
    parallel: issue.parallel,
    blockedByLocalIds: issue.blockedByLocalIds,
    blockedByEpicsOnMain: issue.blockedByEpicsOnMain,
    openBlockerIds: issue.openBlockerIds,
  };
}

export function writeIssueDependencyCacheMap(
  sandcastleDir: string,
  backlogFingerprint: string,
  openReadyForAgent: readonly OpenReadyIssue[],
  issueDependencies: Readonly<Record<string, IssueDependencyCacheEntry>>,
): void {
  saveIssueDependencyCacheMap(sandcastleDir, {
    version: ISSUE_CACHE_VERSION,
    backlogFingerprint,
    githubFetchedAt: new Date().toISOString(),
    openReadyForAgent,
    issueDependencies,
  });
}
