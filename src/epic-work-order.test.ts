import { describe, expect, test } from "bun:test";
import { buildProjectMap } from "./project-map.js";
import { analyzeOpenIssueDependencies } from "./dependency-chain-report.js";
import { deriveEpicWorkOrder, deriveForecastEpicsAfterAnchor, enrichProjectMapWithDependencies } from "./epic-work-order.js";
import type { BriefIssue } from "./planning.js";

function briefIssue(
  id: string,
  epic: string,
  blockers: string[] = [],
  status: BriefIssue["status"] = "open",
  blockedByEpicsOnMain: string[] = [],
): BriefIssue {
  return {
    id,
    localId: id,
    epic,
    title: `[${epic}] ${id}`,
    branch: `feature/${id}`,
    parallel: false,
    blockedByLocalIds: [],
    blockedByEpicsOnMain,
    blockedByGithubIds: blockers.filter((blocker) => !blocker.startsWith("epic:")),
    openBlockerIds: blockers,
    status,
    references: [],
  };
}

describe("deriveEpicWorkOrder", () => {
  test("orders blocker epics before dependents across the chain", () => {
    const openIssues = [
      briefIssue("156", "aa2", ["epic:aa5"]),
      briefIssue("171", "aa5"),
      briefIssue("160", "aa3", ["164"]),
      briefIssue("164", "aa3", ["209"]),
    ];

    const map = buildProjectMap(
      ["aa0", "aa1", "aa2", "aa3", "aa4", "aa5"],
      ["aa0", "aa1", "aa2", "aa3", "aa4", "aa5"],
      openIssues.map((issue) => ({ id: issue.id, title: issue.title, epicSlug: issue.epic })),
    );

    const analysis = analyzeOpenIssueDependencies(openIssues, map.canonicalSequence);
    const order = deriveEpicWorkOrder(analysis, map);

    expect(order.suggestedActiveEpic).toBe("aa5");
    expect(order.workOrder.indexOf("aa5")).toBeLessThan(order.workOrder.indexOf("aa2"));
  });

  test("enriches project map with dependency work order", () => {
    const openIssues = [briefIssue("156", "aa2", ["epic:aa5"]), briefIssue("171", "aa5")];
    const map = buildProjectMap(
      ["aa2", "aa5"],
      ["aa2", "aa5"],
      openIssues.map((issue) => ({ id: issue.id, title: issue.title, epicSlug: issue.epic })),
    );
    const analysis = analyzeOpenIssueDependencies(openIssues, map.canonicalSequence);
    const enriched = enrichProjectMapWithDependencies(map, analysis);

    expect(enriched.suggestedActiveEpic).toBe("aa5");
    expect(enriched.dependencyWorkOrder[0]).toBe("aa5");
    expect(enriched.dependencyWorkOrder[1]).toBe("aa2");
    expect(enriched.forecastEpicsAfterActive).toEqual(["aa2"]);
    expect(enriched.githubSuggestedEpic).toBe("aa2");
  });

  test("derives forecast epics waiting on the active epic in canonical order", () => {
    const openIssues = [
      briefIssue("156", "aa2", ["epic:aa5"]),
      briefIssue("171", "aa5"),
      briefIssue("198", "aa8"),
      briefIssue("177", "aa7", ["epic:aa5", "epic:aa9"]),
      briefIssue("205", "aa9"),
    ];
    const map = buildProjectMap(
      ["aa2", "aa5", "aa7", "aa8", "aa9"],
      ["aa2", "aa5", "aa7", "aa8", "aa9"],
      openIssues.map((issue) => ({ id: issue.id, title: issue.title, epicSlug: issue.epic })),
    );
    const analysis = analyzeOpenIssueDependencies(openIssues, map.canonicalSequence);

    expect(deriveForecastEpicsAfterAnchor(analysis, map, "aa5")).toEqual(["aa2"]);
  });

  test("places forecast epics before parallel-ready epics in visit order", () => {
    const openIssues = [
      briefIssue("156", "aa2", ["epic:aa5"]),
      briefIssue("171", "aa5"),
      briefIssue("160", "aa3", ["164", "209"]),
      briefIssue("164", "aa3", ["209"]),
      briefIssue("209", "aa9", ["207", "208"]),
      briefIssue("198", "aa8", [], "open", ["aa3"]),
      briefIssue("205", "aa9"),
    ];
    const map = buildProjectMap(
      ["aa2", "aa3", "aa5", "aa8", "aa9"],
      ["aa2", "aa3", "aa5", "aa8", "aa9"],
      openIssues.map((issue) => ({ id: issue.id, title: issue.title, epicSlug: issue.epic })),
    );
    const analysis = analyzeOpenIssueDependencies(openIssues, map.canonicalSequence);
    const order = deriveEpicWorkOrder(analysis, map);

    expect(order.workOrder.slice(0, 5)).toEqual(["aa5", "aa2", "aa9", "aa3", "aa8"]);
  });
});
