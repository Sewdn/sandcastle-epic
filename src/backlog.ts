import { readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";

export type IssuePhase = "a" | "b" | "c";

export type EpicMeta = {
  readonly name: string;
  readonly integration_branch: string;
  readonly depends_on?: readonly string[];
  readonly contexts?: readonly string[];
  readonly doc_anchor?: string;
};

export type BacklogIssue = {
  readonly local_id: string;
  readonly epic: string;
  readonly title: string;
  readonly triage: string;
  readonly github: number | null;
  readonly blocked_by_issues?: readonly string[];
  readonly blocked_by_epics_on_main?: readonly string[];
  readonly parallel?: boolean;
  readonly what_to_build: string;
  readonly references?: readonly string[];
};

export type IssueBacklog = {
  readonly version: 1;
  readonly phase: IssuePhase;
  readonly epics: Readonly<Record<string, EpicMeta>>;
  readonly issues: BacklogIssue[];
};

const PHASE_BACKLOG_FILES: Readonly<Record<IssuePhase, string>> = {
  a: "docs/epics/issues.phase-a.yaml",
  b: "docs/epics/issues.phase-b.yaml",
  c: "docs/epics/issues.phase-c.yaml",
};

function stripYamlHeader(raw: string): string {
  return raw.replace(/^#.*\n/m, "");
}

export function phaseForEpicSlug(epic: string): IssuePhase {
  if (/^a\d+$/.test(epic)) {
    return "a";
  }
  if (/^b\d+$/.test(epic)) {
    return "b";
  }
  if (/^c\d+$/.test(epic)) {
    return "c";
  }
  throw new Error(`Cannot infer phase for epic slug '${epic}'.`);
}

export function loadIssueBacklog(repoRoot: string, epic: string): IssueBacklog {
  const phase = phaseForEpicSlug(epic);
  const relativePath = PHASE_BACKLOG_FILES[phase];
  const filePath = path.join(repoRoot, relativePath);
  const raw = readFileSync(filePath, "utf8");
  return parseYaml(stripYamlHeader(raw)) as IssueBacklog;
}

export function epicIssues(backlog: IssueBacklog, epic: string): BacklogIssue[] {
  return backlog.issues.filter((issue) => issue.epic === epic);
}

export function issueByLocalId(backlog: IssueBacklog): ReadonlyMap<string, BacklogIssue> {
  return new Map(backlog.issues.map((issue) => [issue.local_id, issue]));
}

export function githubIdForLocalId(
  localId: string,
  lookup: ReadonlyMap<string, BacklogIssue>,
): string | null {
  const github = lookup.get(localId)?.github;
  return github === null || github === undefined ? null : String(github);
}
