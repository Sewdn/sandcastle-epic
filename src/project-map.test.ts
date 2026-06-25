import { describe, expect, test } from "bun:test";
import {
  buildProjectMap,
  epicSlugFromIssueLabels,
  filterEpicsFromProjectMap,
  openReadyIssuesFromGithubPayload,
} from "./project-map.js";

describe("project map", () => {
  test("groups open ready-for-agent issues by epic label", () => {
    const openIssues = openReadyIssuesFromGithubPayload([
      {
        number: 10,
        title: "Issue A",
        labels: [{ name: "ready-for-agent" }, { name: "epic:aa1" }],
      },
      {
        number: 11,
        title: "Issue B",
        labels: [{ name: "ready-for-agent" }, { name: "epic:aa2" }],
      },
    ]);

    const map = buildProjectMap(["aa0", "aa1", "aa2"], ["aa0", "aa1", "aa2"], openIssues);

    expect(map.completedEpics).toEqual(["aa0"]);
    expect(map.scopedEpicsToRun).toEqual(["aa1", "aa2"]);
    expect(map.scopedEpicsSkipped).toEqual(["aa0"]);
    expect(map.suggestedActiveEpic).toBe("aa1");
    expect(map.epics.find((entry) => entry.epic === "aa1")?.openReadyCount).toBe(1);
  });

  test("treats epics with no open ready-for-agent issues as GitHub-complete", () => {
    const map = buildProjectMap(["a0", "a1"], ["a0", "a1"], []);

    expect(map.completedEpics).toEqual(["a0", "a1"]);
    expect(filterEpicsFromProjectMap(["a0", "a1"], map)).toEqual({
      skipped: ["a0", "a1"],
      toRun: [],
    });
  });

  test("extracts epic slug from labels", () => {
    expect(epicSlugFromIssueLabels([{ name: "epic:aa5" }])).toBe("aa5");
    expect(epicSlugFromIssueLabels([{ name: "ready-for-agent" }])).toBeNull();
  });
});
