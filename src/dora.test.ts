import { describe, expect, test } from "bun:test";
import { hostDoraIndexCommand, patchDoraConfigForHostIndex } from "./dora.js";

describe("patchDoraConfigForHostIndex", () => {
  test("indexes branch checkout but writes shared artifacts to repo root", () => {
    const repoRoot = "/repo";
    const checkout = "/repo/.sandcastle/worktrees/feature-152-copy";
    const patched = patchDoraConfigForHostIndex(
      {
        root: "/home/agent/workspace",
        scip: ".dora/index.scip",
        db: ".dora/dora.db",
        commands: { index: "bun .scripts/dora-index.mjs" },
      },
      repoRoot,
      checkout,
    );

    expect(patched.root).toBe(checkout);
    expect(patched.scip).toBe("/repo/.dora/index.scip");
    expect(patched.db).toBe("/repo/.dora/dora.db");
    expect(patched.commands?.index).toBe(hostDoraIndexCommand(repoRoot));
  });
});
