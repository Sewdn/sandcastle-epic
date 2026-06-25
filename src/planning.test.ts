import { describe, expect, test } from "bun:test";
import { branchNameForIssue, pendingMergeIssuesFromBrief, type EpicBrief } from "./planning.js";

describe("pendingMergeIssuesFromBrief", () => {
  test("returns only unblocked pending merges in dependency order", () => {
    const brief: EpicBrief = {
      epic: "a12",
      epicLabel: "epic:a12",
      integrationBranch: "integrate/epic-a12",
      integrationTip: null,
      epicMeta: null,
      pendingMerge: [],
      integratedIssueIds: [],
      openIssues: [
        {
          id: "105",
          localId: "A12-01",
          title: "[A12] first",
          branch: "feature/105-image-output-controls",
          parallel: false,
          blockedByLocalIds: [],
          blockedByEpicsOnMain: [],
          openBlockerIds: [],
          status: "pending_merge",
          references: [],
        },
        {
          id: "106",
          localId: "A12-02",
          title: "[A12] blocked",
          branch: "feature/106-role-labeled-reference",
          parallel: false,
          blockedByLocalIds: ["A12-01"],
          blockedByEpicsOnMain: [],
          openBlockerIds: ["105"],
          status: "pending_merge",
          references: [],
        },
      ],
      hostAnalysis: {
        unblockedIssues: [],
        blockedIssues: [],
        waitingOnMerge: [],
        suggestedClusters: [],
      },
    };

    expect(pendingMergeIssuesFromBrief(brief)).toEqual([
      {
        id: "105",
        title: "[A12] first",
        branch: "feature/105-image-output-controls",
      },
    ]);
  });
});

describe("branchNameForIssue", () => {
  test("derives deterministic slug from title", () => {
    expect(branchNameForIssue("42", "[A0] Scaffold api-elysia-platform")).toBe(
      "feature/42-scaffold-api-elysia-platform",
    );
  });

  test("reuses existing branch when provided", () => {
    expect(
      branchNameForIssue(
        "50",
        "[A6] Manual upload on existing empty slot",
        "feature/50-manual-upload-on-existing-empty",
      ),
    ).toBe("feature/50-manual-upload-on-existing-empty");
  });

  test("truncates slug to 30 characters", () => {
    const branch = branchNameForIssue(
      "99",
      "[A6] Attach library refs to wall images; derived mood board library query",
    );
    expect(branch).toBe("feature/99-attach-library-refs-to-wall-im");
    expect(branch.length).toBeLessThanOrEqual("feature/99-".length + 30);
  });
});
