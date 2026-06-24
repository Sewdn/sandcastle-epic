import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";

/** Default directory (relative to repo root) containing issue backlog YAML files. */
export const DEFAULT_EPICS_DIR = "docs/epics";

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
  readonly phase: string;
  readonly epics: Readonly<Record<string, EpicMeta>>;
  readonly issues: BacklogIssue[];
};

export type BacklogDiscoveryOptions = {
  /** Relative to repo root. Defaults to {@link DEFAULT_EPICS_DIR}. */
  readonly epicsDir?: string;
};

const stripYamlHeader = (raw: string): string => raw.replace(/^#.*\n/m, "");

/** Host projects use `issues.phase-<id>.yaml` files under the epics directory. */
export const isIssueBacklogFile = (fileName: string): boolean =>
  fileName.startsWith("issues.phase-") && fileName.endsWith(".yaml");

export function resolveEpicsDir(repoRoot: string, options: BacklogDiscoveryOptions = {}): string {
  return path.join(repoRoot, options.epicsDir ?? DEFAULT_EPICS_DIR);
}

/** Issue backlog YAML paths under the epics directory, sorted alphabetically. */
export function listIssueBacklogFiles(
  repoRoot: string,
  options: BacklogDiscoveryOptions = {},
): readonly string[] {
  const epicsDir = resolveEpicsDir(repoRoot, options);

  try {
    return readdirSync(epicsDir)
      .filter(isIssueBacklogFile)
      .sort((left, right) => left.localeCompare(right))
      .map((fileName) => path.join(epicsDir, fileName));
  } catch {
    return [];
  }
}

const parseBacklogFile = (filePath: string): IssueBacklog => {
  const raw = readFileSync(filePath, "utf8");
  return parseYaml(stripYamlHeader(raw)) as IssueBacklog;
};

/** Find the backlog file that defines `epic`, scanning files in alphabetical order. */
export function findIssueBacklogFileForEpic(
  repoRoot: string,
  epic: string,
  options: BacklogDiscoveryOptions = {},
): string | null {
  for (const filePath of listIssueBacklogFiles(repoRoot, options)) {
    const doc = parseBacklogFile(filePath);
    if (doc.epics?.[epic]) {
      return filePath;
    }
  }

  return null;
}

export function loadIssueBacklog(
  repoRoot: string,
  epic: string,
  options: BacklogDiscoveryOptions = {},
): IssueBacklog {
  const filePath = findIssueBacklogFileForEpic(repoRoot, epic, options);

  if (!filePath) {
    throw new Error(
      `No issue backlog file defines epic '${epic}' under ${options.epicsDir ?? DEFAULT_EPICS_DIR}.`,
    );
  }

  return parseBacklogFile(filePath);
}

/** Canonical epic order from all backlog YAML files in alphabetical file order. */
export function loadCanonicalEpicSequence(
  repoRoot: string,
  options: BacklogDiscoveryOptions = {},
): string[] {
  const sequence: string[] = [];

  for (const filePath of listIssueBacklogFiles(repoRoot, options)) {
    const doc = parseBacklogFile(filePath);
    if (doc.epics) {
      sequence.push(...Object.keys(doc.epics));
    }
  }

  return sequence;
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
