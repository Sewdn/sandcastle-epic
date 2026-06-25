import { describe, expect, test } from "bun:test";
import { analyzeOpenIssueDependencies } from "./dependency-chain-report.js";
import { buildProjectMap } from "./project-map.js";
import {
  collapseEpicLabels,
  collapseIssueIds,
  resolveProjectMapReportSections,
} from "./project-map-report.js";
import type { BriefIssue } from "./planning.js";

function briefIssue(
  id: string,
  epic: string,
  blockers: string[] = [],
): BriefIssue {
  return {
    id,
    localId: id,
    epic,
    title: `[${epic}] ${id}`,
    branch: `feature/${id}`,
    parallel: false,
    blockedByLocalIds: [],
    blockedByEpicsOnMain: [],
    blockedByGithubIds: [],
    openBlockerIds: blockers,
    status: "open",
    references: [],
  };
}

describe("resolveProjectMapReportSections", () => {
  test("splits anchor + next two into detail and collapses the rest", () => {
    const openIssues = [
      { id: "100", title: "Issue aa2", epicSlug: "aa2" },
      { id: "101", title: "Issue aa3", epicSlug: "aa3" },
      { id: "102", title: "Issue aa4", epicSlug: "aa4" },
      { id: "103", title: "Issue aa5", epicSlug: "aa5" },
      { id: "104", title: "Issue aa6", epicSlug: "aa6" },
      { id: "105", title: "Issue aa7", epicSlug: "aa7" },
      { id: "106", title: "Issue aa8", epicSlug: "aa8" },
    ];

    const sequence = ["aa0", "aa1", "aa2", "aa3", "aa4", "aa5", "aa6", "aa7", "aa8"];
    const map = buildProjectMap(sequence, sequence, openIssues);

    const sections = resolveProjectMapReportSections(map, {
      scopedEpics: sequence,
      highlightEpics: ["aa2"],
    });

    expect(sections.anchorEpic).toBe("aa2");
    expect(sections.detailEntries.map((entry) => entry.epic)).toEqual(["aa2", "aa3", "aa4"]);
    expect(sections.laterEntries.map((entry) => entry.epic)).toEqual(["aa5", "aa6", "aa7", "aa8"]);
  });

  test("shows forecast epics after anchor instead of parallel-ready visit order", () => {
    const sequence = ["aa2", "aa5", "aa8", "aa9"];
    const openIssues = [
      briefIssue("156", "aa2", ["epic:aa5"]),
      briefIssue("171", "aa5"),
      briefIssue("198", "aa8"),
      briefIssue("205", "aa9"),
    ];
    const map = buildProjectMap(
      sequence,
      sequence,
      openIssues.map((issue) => ({ id: issue.id, title: issue.title, epicSlug: issue.epic })),
    );
    const analysis = analyzeOpenIssueDependencies(openIssues, sequence);
    const enriched = {
      ...map,
      suggestedActiveEpic: "aa5",
      forecastEpicsAfterActive: ["aa2"],
      dependencyWorkOrder: ["aa5", "aa2", "aa8", "aa9"],
    };

    const sections = resolveProjectMapReportSections(enriched, {
      scopedEpics: sequence,
      dependencyAnalysis: analysis,
    });

    expect(sections.anchorEpic).toBe("aa5");
    expect(sections.detailEntries.map((entry) => entry.epic)).toEqual(["aa5", "aa2"]);
    expect(sections.laterEntries.map((entry) => entry.epic)).toEqual(["aa8", "aa9"]);
  });

  test("orders later epics by visit order, not canonical sequence", () => {
    const sequence = ["aa2", "aa3", "aa5", "aa6", "aa8", "aa9"];
    const openIssues = [
      briefIssue("156", "aa2", ["epic:aa5"]),
      briefIssue("171", "aa5"),
      briefIssue("160", "aa3"),
      briefIssue("183", "aa6"),
      briefIssue("198", "aa8"),
      briefIssue("205", "aa9"),
    ];
    const map = buildProjectMap(
      sequence,
      sequence,
      openIssues.map((issue) => ({ id: issue.id, title: issue.title, epicSlug: issue.epic })),
    );
    const analysis = analyzeOpenIssueDependencies(openIssues, sequence);
    const enriched = {
      ...map,
      suggestedActiveEpic: "aa5",
      forecastEpicsAfterActive: ["aa2"],
      dependencyWorkOrder: ["aa5", "aa2", "aa9", "aa3", "aa8", "aa6"],
    };

    const sections = resolveProjectMapReportSections(enriched, {
      scopedEpics: sequence,
      dependencyAnalysis: analysis,
    });

    expect(sections.laterEntries.map((entry) => entry.epic)).toEqual(["aa9", "aa3", "aa8", "aa6"]);
  });

  test("omits GitHub-complete epics from sections", () => {
    const map = buildProjectMap(["aa0", "aa1", "aa2"], ["aa0", "aa1", "aa2"], [
      { id: "9", title: "Issue", epicSlug: "aa2" },
    ]);

    const sections = resolveProjectMapReportSections(map, {
      scopedEpics: ["aa0", "aa1", "aa2"],
    });

    expect(sections.detailEntries.map((entry) => entry.epic)).toEqual(["aa2"]);
    expect(sections.laterEntries).toEqual([]);
  });
});

describe("collapseEpicLabels", () => {
  test("truncates long epic lists", () => {
    expect(collapseEpicLabels(["aa2", "aa3", "aa5", "aa6"], 2)).toBe("aa2, aa3 +2 epics");
  });
});

describe("collapseIssueIds", () => {
  test("truncates long issue lists", () => {
    const entries = [
      {
        epic: "aa5",
        epicLabel: "epic:aa5",
        integrationBranch: "integrate/epic-aa5",
        status: "has_work" as const,
        openReadyCount: 7,
        openReadyForAgent: [1, 2, 3, 4, 5, 6, 7].map((id) => ({
          id: String(170 + id),
          title: `Issue ${id}`,
        })),
      },
    ];

    const { count, display } = collapseIssueIds(entries, 4);
    expect(count).toBe(7);
    expect(display).toBe("#171, #172, #173, #174 … +3 more");
  });
});
