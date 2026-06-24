import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { priorCompletedEpic } from "./completed-epics.js";
import { resolveLongRunConfig } from "./longrun.js";

function writePhaseBacklog(
  epicsDir: string,
  phase: string,
  epics: readonly string[],
): void {
  const epicEntries = epics
    .map(
      (slug) => `  ${slug}:
    name: ${slug}
    integration_branch: integrate/epic-${slug}`,
    )
    .join("\n");

  writeFileSync(
    join(epicsDir, `issues.phase-${phase}.yaml`),
    `version: 1
phase: ${phase}
epics:
${epicEntries}
issues: []
`,
  );
}

describe("resolveLongRunConfig", () => {
  test("limits epics to a single phase when phase is set", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "sandcastle-epic-longrun-"));
    const epicsDir = join(repoRoot, "docs/epics");
    mkdirSync(epicsDir, { recursive: true });

    writePhaseBacklog(epicsDir, "a", ["a0", "a1"]);
    writePhaseBacklog(epicsDir, "aa", ["aa0", "aa1"]);

    const config = resolveLongRunConfig({ repoRoot, phase: "aa" });

    expect(config.epics).toEqual(["aa0", "aa1"]);
    expect(config.phase).toBe("aa");
    expect(config.canonicalEpicSequence).toEqual(["a0", "a1", "aa0", "aa1"]);
  });

  test("rejects explicit epics outside the selected phase", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "sandcastle-epic-longrun-invalid-"));
    const epicsDir = join(repoRoot, "docs/epics");
    mkdirSync(epicsDir, { recursive: true });

    writePhaseBacklog(epicsDir, "a", ["a0"]);
    writePhaseBacklog(epicsDir, "aa", ["aa0"]);

    expect(() =>
      resolveLongRunConfig({ repoRoot, phase: "aa", epics: "a0,aa0" }),
    ).toThrow(/not in phase 'aa'/);
  });
});

describe("priorCompletedEpic", () => {
  test("uses canonical sequence for cross-phase handoff when phase-scoped", () => {
    const completed = ["a0", "a1"];
    const phaseEpics = ["aa0", "aa1"];
    const canonical = ["a0", "a1", "aa0", "aa1"];

    expect(priorCompletedEpic("aa0", completed, phaseEpics, canonical)).toBe("a1");
  });
});
