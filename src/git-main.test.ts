import { describe, expect, test } from "bun:test";
import {
  buildIntegrationBranchSyncSteps,
  integrationHandoffSeedRef,
} from "./git-main.js";

describe("integrationHandoffSeedRef", () => {
  test("uses the prior integration branch when it still exists", () => {
    expect(
      integrationHandoffSeedRef({
        previousBranch: "integrate/epic-aa5",
        previousBranchExists: true,
        mainBranch: "main",
      }),
    ).toBe("integrate/epic-aa5");
  });

  test("falls back to main when the prior integration branch was merged", () => {
    expect(
      integrationHandoffSeedRef({
        previousBranch: "integrate/epic-aa5",
        previousBranchExists: false,
        mainBranch: "main",
      }),
    ).toBe("main");
  });
});

describe("buildIntegrationBranchSyncSteps", () => {
  test("returns empty list for no epics", () => {
    expect(buildIntegrationBranchSyncSteps([], "main")).toEqual([]);
  });

  test("merges main into the first integration branch", () => {
    expect(buildIntegrationBranchSyncSteps(["a0"], "main")).toEqual([
      { targetBranch: "integrate/epic-a0", sourceBranch: "main" },
    ]);
  });

  test("chains each integration branch into the next epic branch", () => {
    expect(buildIntegrationBranchSyncSteps(["a0", "a1", "a2"], "main")).toEqual([
      { targetBranch: "integrate/epic-a0", sourceBranch: "main" },
      { targetBranch: "integrate/epic-a1", sourceBranch: "integrate/epic-a0" },
      { targetBranch: "integrate/epic-a2", sourceBranch: "integrate/epic-a1" },
    ]);
  });
});
