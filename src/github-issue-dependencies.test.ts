import { describe, expect, test } from "bun:test";
import { planBlockedBySync } from "./github-issue-dependencies.js";

describe("planBlockedBySync", () => {
  test("adds missing and removes stale blocked-by relationships", () => {
    const plan = planBlockedBySync(
      [
        { number: 10, databaseId: 100 },
        { number: 11, databaseId: 110 },
      ],
      [11, 12],
    );

    expect(plan.add).toEqual([12]);
    expect(plan.remove).toEqual([{ number: 10, databaseId: 100 }]);
  });

  test("returns empty plan when GitHub already matches backlog", () => {
    const plan = planBlockedBySync([{ number: 9, databaseId: 90 }], [9]);
    expect(plan.add).toEqual([]);
    expect(plan.remove).toEqual([]);
  });
});
