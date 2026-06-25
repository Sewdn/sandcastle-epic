import { describe, expect, test } from "bun:test";
import { formatAffectedValidationScope } from "./affected.js";

describe("formatAffectedValidationScope", () => {
  test("lists turbo filters for impacted packages", () => {
    const formatted = formatAffectedValidationScope([
      "@verbouwing/svc-stylecatalog",
      "@verbouwing/domain-stylecatalog",
    ]);

    expect(formatted).toContain("@verbouwing/svc-stylecatalog");
    expect(formatted).toContain("--filter @verbouwing/svc-stylecatalog");
    expect(formatted).toContain("do **not** run root `bun run typecheck`");
  });

  test("handles empty package list", () => {
    expect(formatAffectedValidationScope([])).toContain("No workspace package roots detected");
  });
});
