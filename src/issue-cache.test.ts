import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  backlogDependencyFingerprint,
  isIssueDependencyCacheValid,
  ISSUE_CACHE_VERSION,
  loadIssueDependencyCacheMap,
  openIssueSetsMatch,
  saveIssueDependencyCacheMap,
} from "./issue-cache.js";

describe("issue dependency cache", () => {
  const sandcastleDir = mkdtempSync(path.join(tmpdir(), "sandcastle-cache-"));

  test("round-trips cachemap.json", () => {
    const fingerprint = backlogDependencyFingerprint(process.cwd());
    saveIssueDependencyCacheMap(sandcastleDir, {
      version: ISSUE_CACHE_VERSION,
      backlogFingerprint: fingerprint,
      githubFetchedAt: new Date().toISOString(),
      openReadyForAgent: [{ id: "171", title: "Test", epicSlug: "aa5", blockedByGithubIds: [] }],
      issueDependencies: {
        "171": {
          id: "171",
          localId: "AA5-01",
          epic: "aa5",
          title: "Test",
          parallel: false,
          blockedByLocalIds: [],
          blockedByEpicsOnMain: [],
          blockedByGithubIds: [],
          openBlockerIds: [],
        },
      },
    });

    const loaded = loadIssueDependencyCacheMap(sandcastleDir);
    expect(loaded?.openReadyForAgent).toHaveLength(1);
    expect(loaded?.issueDependencies["171"]?.epic).toBe("aa5");
  });

  test("invalidates when backlog fingerprint differs", () => {
    const loaded = loadIssueDependencyCacheMap(sandcastleDir);
    expect(loaded).not.toBeNull();
    expect(
      isIssueDependencyCacheValid(loaded!, "different-fingerprint", {}),
    ).toBe(false);
  });

  test("open issue sets match ignores order", () => {
    expect(
      openIssueSetsMatch(
        [
          { id: "2", title: "b", epicSlug: "aa2", blockedByGithubIds: [] },
          { id: "1", title: "a", epicSlug: "aa1", blockedByGithubIds: [] },
        ],
        [
          { id: "1", title: "a", epicSlug: "aa1", blockedByGithubIds: [] },
          { id: "2", title: "b", epicSlug: "aa2", blockedByGithubIds: [] },
        ],
      ),
    ).toBe(true);
    expect(
      openIssueSetsMatch(
        [{ id: "1", title: "a", epicSlug: "aa1", blockedByGithubIds: [] }],
        [{ id: "2", title: "b", epicSlug: "aa2", blockedByGithubIds: [] }],
      ),
    ).toBe(false);
  });

  rmSync(sandcastleDir, { recursive: true, force: true });
});
