import { describe, expect, test } from "bun:test";
import { branchNameForIssue } from "./planning.js";

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
