import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  backlogPhaseFromFileName,
  isIssueBacklogFile,
  listBacklogPhases,
  listIssueBacklogFiles,
  loadCanonicalEpicSequence,
  loadEpicSequenceForPhase,
  loadIssueBacklog,
} from "./backlog.js";

describe("isIssueBacklogFile", () => {
  test("matches issues.phase-*.yaml only", () => {
    expect(isIssueBacklogFile("issues.phase-a.yaml")).toBe(true);
    expect(isIssueBacklogFile("issues.phase-aa.yaml")).toBe(true);
    expect(isIssueBacklogFile("phase-a.md")).toBe(false);
    expect(isIssueBacklogFile("issue-backlog.schema.json")).toBe(false);
  });
});

describe("listIssueBacklogFiles", () => {
  test("returns backlog YAML files in alphabetical order", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "sandcastle-epic-backlog-"));
    const epicsDir = join(repoRoot, "docs/epics");
    mkdirSync(epicsDir, { recursive: true });

    writeFileSync(join(epicsDir, "issues.phase-b.yaml"), "version: 1\nphase: b\nepics: {}\nissues: []\n");
    writeFileSync(join(epicsDir, "issues.phase-a.yaml"), "version: 1\nphase: a\nepics: {}\nissues: []\n");
    writeFileSync(join(epicsDir, "issues.phase-aa.yaml"), "version: 1\nphase: aa\nepics: {}\nissues: []\n");
    writeFileSync(join(epicsDir, "phase-a.md"), "# not a backlog file\n");

    const files = listIssueBacklogFiles(repoRoot).map((filePath) => filePath.split("/").pop());
    expect(files).toEqual(["issues.phase-a.yaml", "issues.phase-aa.yaml", "issues.phase-b.yaml"]);
  });
});

describe("backlogPhaseFromFileName", () => {
  test("extracts phase id from backlog file names", () => {
    expect(backlogPhaseFromFileName("issues.phase-a.yaml")).toBe("a");
    expect(backlogPhaseFromFileName("issues.phase-aa.yaml")).toBe("aa");
    expect(backlogPhaseFromFileName("phase-a.md")).toBeNull();
  });
});

describe("loadEpicSequenceForPhase", () => {
  test("returns epics for a single phase only", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "sandcastle-epic-backlog-phase-"));
    const epicsDir = join(repoRoot, "docs/epics");
    mkdirSync(epicsDir, { recursive: true });

    writeFileSync(
      join(epicsDir, "issues.phase-a.yaml"),
      `version: 1
phase: a
epics:
  a0:
    name: A0
    integration_branch: integrate/epic-a0
issues: []
`,
    );

    writeFileSync(
      join(epicsDir, "issues.phase-aa.yaml"),
      `version: 1
phase: aa
epics:
  aa0:
    name: AA0
    integration_branch: integrate/epic-aa0
  aa1:
    name: AA1
    integration_branch: integrate/epic-aa1
issues: []
`,
    );

    expect(loadEpicSequenceForPhase(repoRoot, "aa")).toEqual(["aa0", "aa1"]);
    expect(listBacklogPhases(repoRoot)).toEqual(["a", "aa"]);
  });

  test("throws when the phase backlog file is missing", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "sandcastle-epic-backlog-missing-"));
    expect(() => loadEpicSequenceForPhase(repoRoot, "aa")).toThrow(/Available phase\(s\)/);
  });
});

describe("loadCanonicalEpicSequence", () => {
  test("concatenates epics in alphabetical backlog file order", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "sandcastle-epic-backlog-"));
    const epicsDir = join(repoRoot, "docs/epics");
    mkdirSync(epicsDir, { recursive: true });

    writeFileSync(
      join(epicsDir, "issues.phase-a.yaml"),
      `version: 1
phase: a
epics:
  a0:
    name: A0
    integration_branch: integrate/epic-a0
  a1:
    name: A1
    integration_branch: integrate/epic-a1
issues: []
`,
    );

    writeFileSync(
      join(epicsDir, "issues.phase-aa.yaml"),
      `version: 1
phase: aa
epics:
  aa0:
    name: AA0
    integration_branch: integrate/epic-aa0
  aa1:
    name: AA1
    integration_branch: integrate/epic-aa1
issues: []
`,
    );

    expect(loadCanonicalEpicSequence(repoRoot)).toEqual(["a0", "a1", "aa0", "aa1"]);
  });

  test("supports a custom epics directory", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "sandcastle-epic-backlog-custom-"));
    const epicsDir = join(repoRoot, "planning/epics");
    mkdirSync(epicsDir, { recursive: true });

    writeFileSync(
      join(epicsDir, "issues.phase-x.yaml"),
      `version: 1
phase: x
epics:
  x0:
    name: X0
    integration_branch: integrate/epic-x0
issues: []
`,
    );

    expect(loadCanonicalEpicSequence(repoRoot, { epicsDir: "planning/epics" })).toEqual(["x0"]);
  });
});

describe("loadIssueBacklog", () => {
  test("loads the backlog file that defines the epic", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "sandcastle-epic-backlog-load-"));
    const epicsDir = join(repoRoot, "docs/epics");
    mkdirSync(epicsDir, { recursive: true });

    writeFileSync(
      join(epicsDir, "issues.phase-a.yaml"),
      `version: 1
phase: a
epics:
  a0:
    name: A0
    integration_branch: integrate/epic-a0
issues: []
`,
    );

    writeFileSync(
      join(epicsDir, "issues.phase-aa.yaml"),
      `version: 1
phase: aa
epics:
  aa0:
    name: AA0
    integration_branch: integrate/epic-aa0
issues:
  - local_id: AA0-01
    epic: aa0
    title: Test
    triage: ready-for-agent
    github: 1
    what_to_build: Build it
`,
    );

    const backlog = loadIssueBacklog(repoRoot, "aa0");
    expect(backlog.phase).toBe("aa");
    expect(backlog.issues).toHaveLength(1);
  });
});
