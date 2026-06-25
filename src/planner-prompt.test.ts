import { describe, expect, test } from "bun:test";
import type { EpicBrief } from "./planning.js";
import type { ProjectMap } from "./project-map.js";
import {
  formatHostPlannerBaselineForPrompt,
  formatProjectContextForPrompt,
} from "./planner-prompt.js";

const minimalBrief: EpicBrief = {
  epic: "aa5",
  epicLabel: "epic:aa5",
  integrationBranch: "integrate/epic-aa5",
  integrationTip: null,
  epicMeta: null,
  pendingMerge: [],
  integratedIssueIds: [],
  forecastEpicsAfterActive: ["aa2"],
  openIssues: [
    {
      id: "171",
      localId: "AA5-01",
      epic: "aa5",
      title: "[AA5] Home API",
      branch: "feature/171-home-api",
      parallel: false,
      blockedByLocalIds: [],
      blockedByEpicsOnMain: [],
      blockedByGithubIds: [],
      openBlockerIds: [],
      status: "open",
      references: [],
    },
    {
      id: "172",
      localId: "AA5-02",
      epic: "aa5",
      title: "[AA5] Blocked",
      branch: "feature/172-blocked",
      parallel: false,
      blockedByLocalIds: ["AA5-01"],
      blockedByEpicsOnMain: [],
      blockedByGithubIds: ["171"],
      openBlockerIds: ["171"],
      status: "open",
      references: [],
    },
  ],
  hostAnalysis: {
    unblockedIssues: [{ id: "171", title: "[AA5] Home API", branch: "feature/171-home-api" }],
    unblockedForCurrentEpic: [
      { id: "171", title: "[AA5] Home API", branch: "feature/171-home-api" },
    ],
    blockedIssues: [{ id: "172", epic: "aa5", blockedByGithubIds: ["171"], openBlockerIds: ["171"] }],
    waitingOnMerge: [],
    suggestedClusters: [
      {
        reason: "Host default",
        issues: [{ id: "171", title: "[AA5] Home API", branch: "feature/171-home-api" }],
      },
    ],
    dependencyChain: [],
    readyNow: [],
    blocked: [
      {
        id: "172",
        epic: "aa5",
        title: "[AA5] Blocked",
        status: "blocked",
        openBlockerIds: ["171"],
      },
    ],
    pendingMergeInChain: [],
  },
};

const minimalProjectMap: ProjectMap = {
  fetchedAt: "2026-06-25T12:00:00.000Z",
  source: "github",
  canonicalSequence: ["aa5", "aa2"],
  scopedEpics: ["aa5", "aa2"],
  epics: [],
  completedEpics: [],
  scopedEpicsToRun: ["aa5", "aa2"],
  scopedEpicsSkipped: [],
  dependencyWorkOrder: ["aa5", "aa2"],
  forecastEpicsAfterActive: ["aa2"],
  githubSuggestedEpic: "aa5",
  suggestedActiveEpic: "aa5",
};

describe("formatHostPlannerBaselineForPrompt", () => {
  test("includes ready and blocked tables without full openIssues dump", () => {
    const text = formatHostPlannerBaselineForPrompt(minimalBrief, minimalProjectMap);
    expect(text).toContain("#171");
    expect(text).toContain("#172");
    expect(text).toContain("171");
    expect(text).not.toContain("openIssues");
    expect(Buffer.byteLength(text, "utf8")).toBeLessThan(8_000);
  });
});

describe("formatProjectContextForPrompt", () => {
  test("summarizes visit order without issue lists", () => {
    const text = formatProjectContextForPrompt(minimalProjectMap);
    expect(text).toContain("aa5 → aa2");
    expect(text).toContain("Forecast after active: aa2");
    expect(Buffer.byteLength(text, "utf8")).toBeLessThan(1_000);
  });
});
