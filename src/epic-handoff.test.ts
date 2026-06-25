import { describe, expect, test } from "bun:test";
import { buildDependencyIntegrationMergeSteps } from "./epic-handoff.js";

describe("buildDependencyIntegrationMergeSteps", () => {
  test("returns empty list when there are no dependency epics", () => {
    expect(buildDependencyIntegrationMergeSteps("aa2", [])).toEqual([]);
  });

  test("maps dependency epics to integration branch merge steps", () => {
    expect(buildDependencyIntegrationMergeSteps("aa2", ["aa5"])).toEqual([
      {
        targetEpic: "aa2",
        sourceEpic: "aa5",
        targetBranch: "integrate/epic-aa2",
        sourceBranch: "integrate/epic-aa5",
      },
    ]);
  });

  test("preserves dependency order for multiple upstream epics", () => {
    expect(buildDependencyIntegrationMergeSteps("aa2", ["aa5", "aa8"])).toEqual([
      {
        targetEpic: "aa2",
        sourceEpic: "aa5",
        targetBranch: "integrate/epic-aa2",
        sourceBranch: "integrate/epic-aa5",
      },
      {
        targetEpic: "aa2",
        sourceEpic: "aa8",
        targetBranch: "integrate/epic-aa2",
        sourceBranch: "integrate/epic-aa8",
      },
    ]);
  });
});
