import { describe, expect, test } from "bun:test";
import type { BriefIssue } from "./planning.js";
import { orderDependencyChain } from "./dependency-chain-report.js";

const issue = (
  id: string,
  epic: string,
  status: BriefIssue["status"],
  openBlockerIds: string[] = [],
): BriefIssue => ({
  id,
  localId: id,
  epic,
  title: `[${epic}] ${id}`,
  branch: `feature/${id}`,
  parallel: false,
  blockedByLocalIds: [],
  blockedByEpicsOnMain: [],
  blockedByGithubIds: [],
  openBlockerIds,
  status,
  references: [],
});

describe("orderDependencyChain", () => {
  test("orders ready before pending merge before blocked, then by epic and id", () => {
    const chain = orderDependencyChain(
      [
        issue("200", "aa3", "open", ["156"]),
        issue("156", "aa2", "open", ["epic:aa5"]),
        issue("160", "aa3", "open"),
        issue("155", "aa2", "pending_merge"),
      ],
      ["aa0", "aa1", "aa2", "aa3"],
    );

    expect(chain.map((entry) => entry.id)).toEqual(["160", "155", "156", "200"]);
    expect(chain.find((entry) => entry.id === "160")?.status).toBe("ready");
    expect(chain.find((entry) => entry.id === "156")?.status).toBe("blocked");
  });
});
