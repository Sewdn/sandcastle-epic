import { describe, expect, test } from "bun:test";
import { parseFeatureBranchIssueId } from "./git.js";

describe("parseFeatureBranchIssueId", () => {
  test("extracts issue number from feature branch names", () => {
    expect(parseFeatureBranchIssueId("feature/20-configure-cors-session-cookies")).toBe("20");
    expect(parseFeatureBranchIssueId("feature/8-scaffold-api-elysia-platform")).toBe("8");
  });

  test("returns null for non-feature branches", () => {
    expect(parseFeatureBranchIssueId("integrate/epic-a1")).toBeNull();
    expect(parseFeatureBranchIssueId("feature/no-number-slug")).toBeNull();
  });
});
