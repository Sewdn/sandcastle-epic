import { describe, expect, test } from "bun:test";
import type { EpicBrief } from "./planning.js";
import { printEpicPlanReport, printHostPlannerBaselineReport } from "./planner-report.js";

describe("printHostPlannerBaselineReport", () => {
  test("renders without throwing for a minimal brief", () => {
    const brief: EpicBrief = {
      epic: "aa2",
      epicLabel: "epic:aa2",
      integrationBranch: "integrate/epic-aa2",
      integrationTip: null,
      epicMeta: null,
      pendingMerge: [],
      integratedIssueIds: [],
      openIssues: [
        {
          id: "156",
          localId: "AA2-01",
          epic: "aa2",
          title: "[AA2] Example",
          branch: "feature/156-example",
          parallel: false,
          blockedByLocalIds: [],
          blockedByEpicsOnMain: ["aa5"],
          openBlockerIds: ["epic:aa5"],
          status: "open",
          references: [],
        },
      ],
      forecastEpicsAfterActive: [],
      hostAnalysis: {
        unblockedIssues: [],
        unblockedForCurrentEpic: [],
        blockedIssues: [{ id: "156", epic: "aa2", openBlockerIds: ["epic:aa5"] }],
        waitingOnMerge: [],
        suggestedClusters: [],
        dependencyChain: [],
        readyNow: [],
        blocked: [{ id: "156", epic: "aa2", title: "[AA2] Example", status: "blocked", openBlockerIds: ["epic:aa5"] }],
        pendingMergeInChain: [],
      },
    };

    expect(() => printHostPlannerBaselineReport(brief, null)).not.toThrow();
  });
});

describe("printEpicPlanReport", () => {
  test("renders planner clusters", () => {
    expect(() =>
      printEpicPlanReport(
        [
          {
            reason: "Shared wall-images module",
            skills: { implementation: ["/dora"], review: ["/validate"] },
            issues: [
              { id: "160", title: "[AA3] One", branch: "feature/160-one" },
              { id: "165", title: "[AA3] Two", branch: "feature/165-two" },
            ],
          },
        ],
        { epicLabel: "epic:aa3", source: "planner-agent" },
      ),
    ).not.toThrow();
  });
});
