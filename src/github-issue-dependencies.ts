import { $ } from "bun";

export type GithubBlockedByIssue = {
  readonly number: number;
  readonly databaseId: number;
};

type GithubIssueRow = {
  readonly number: number;
  readonly id: number;
};

function parseRepoSlug(repo: string): string {
  const trimmed = repo.trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(trimmed)) {
    throw new Error(`Invalid GitHub repo slug: ${repo}`);
  }
  return trimmed;
}

/** Resolve `owner/repo` from the current working directory via gh. */
export async function resolveGithubRepoSlug(): Promise<string> {
  const result = await $`gh repo view --json nameWithOwner -q .nameWithOwner`.quiet().nothrow();
  if (result.exitCode !== 0) {
    const detail = result.stderr.toString().trim();
    throw new Error(
      `Failed to resolve GitHub repo slug${detail ? `: ${detail}` : ""}`,
    );
  }
  const slug = result.stdout.toString().trim();
  if (!slug) {
    throw new Error("Failed to resolve GitHub repo slug: empty response");
  }
  return slug;
}

export async function fetchIssueDatabaseId(
  repo: string,
  issueNumber: number,
): Promise<number> {
  const slug = parseRepoSlug(repo);
  const result =
    await $`gh api repos/${slug}/issues/${issueNumber} --jq .id`.quiet().nothrow();
  if (result.exitCode !== 0) {
    const detail = result.stderr.toString().trim();
    throw new Error(
      `Failed to fetch database id for #${issueNumber}${detail ? `: ${detail}` : ""}`,
    );
  }
  const id = Number(result.stdout.toString().trim());
  if (!Number.isFinite(id)) {
    throw new Error(`Invalid database id for #${issueNumber}`);
  }
  return id;
}

/** List issues that block `issueNumber` (GitHub structured blocked-by relationships). */
export async function fetchIssueBlockedBy(
  repo: string,
  issueNumber: number,
): Promise<readonly GithubBlockedByIssue[]> {
  const slug = parseRepoSlug(repo);
  const result =
    await $`gh api repos/${slug}/issues/${issueNumber}/dependencies/blocked_by --paginate`
      .quiet()
      .nothrow();

  if (result.exitCode !== 0) {
    const detail = result.stderr.toString().trim();
    throw new Error(
      `Failed to list blocked-by for #${issueNumber}${detail ? `: ${detail}` : ""}`,
    );
  }

  const raw = result.stdout.toString().trim();
  if (raw.length === 0) {
    return [];
  }

  const parsed = JSON.parse(raw) as GithubIssueRow | GithubIssueRow[];
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  return rows.map((row) => ({
    number: row.number,
    databaseId: row.id,
  }));
}

export async function addIssueBlockedBy(
  repo: string,
  issueNumber: number,
  blockingIssueNumber: number,
): Promise<void> {
  const slug = parseRepoSlug(repo);
  const blockingDatabaseId = await fetchIssueDatabaseId(slug, blockingIssueNumber);
  const result =
    await $`gh api repos/${slug}/issues/${issueNumber}/dependencies/blocked_by -X POST -F issue_id=${blockingDatabaseId}`
      .quiet()
      .nothrow();

  if (result.exitCode !== 0) {
    const detail = result.stderr.toString().trim();
    throw new Error(
      `Failed to mark #${issueNumber} blocked by #${blockingIssueNumber}${detail ? `: ${detail}` : ""}`,
    );
  }
}

export async function removeIssueBlockedBy(
  repo: string,
  issueNumber: number,
  blockingDatabaseId: number,
): Promise<void> {
  const slug = parseRepoSlug(repo);
  const result =
    await $`gh api repos/${slug}/issues/${issueNumber}/dependencies/blocked_by/${blockingDatabaseId} -X DELETE`
      .quiet()
      .nothrow();

  if (result.exitCode !== 0) {
    const detail = result.stderr.toString().trim();
    throw new Error(
      `Failed to remove blocked-by ${blockingDatabaseId} from #${issueNumber}${detail ? `: ${detail}` : ""}`,
    );
  }
}

export type BlockedBySyncPlan = {
  readonly add: readonly number[];
  readonly remove: readonly GithubBlockedByIssue[];
};

export function planBlockedBySync(
  current: readonly GithubBlockedByIssue[],
  expectedBlockingNumbers: readonly number[],
): BlockedBySyncPlan {
  const expected = new Set(expectedBlockingNumbers);
  const currentNumbers = new Set(current.map((entry) => entry.number));

  return {
    add: expectedBlockingNumbers.filter((number) => !currentNumbers.has(number)),
    remove: current.filter((entry) => !expected.has(entry.number)),
  };
}

export async function syncIssueBlockedByRelationships(
  repo: string,
  issueNumber: number,
  expectedBlockingNumbers: readonly number[],
  dryRun: boolean,
): Promise<{ readonly added: number; readonly removed: number }> {
  const current = await fetchIssueBlockedBy(repo, issueNumber);
  const plan = planBlockedBySync(current, expectedBlockingNumbers);

  if (dryRun) {
    return { added: plan.add.length, removed: plan.remove.length };
  }

  for (const blocking of plan.remove) {
    await removeIssueBlockedBy(repo, issueNumber, blocking.databaseId);
  }
  for (const blockingNumber of plan.add) {
    await addIssueBlockedBy(repo, issueNumber, blockingNumber);
  }

  return { added: plan.add.length, removed: plan.remove.length };
}

/** Fetch blocked-by issue numbers for many issues (concurrency-limited). */
export async function fetchBlockedByForIssues(
  repo: string,
  issueNumbers: readonly number[],
  concurrency = 8,
): Promise<Map<string, readonly string[]>> {
  const result = new Map<string, readonly string[]>();
  let index = 0;

  async function worker(): Promise<void> {
    while (index < issueNumbers.length) {
      const issueNumber = issueNumbers[index];
      index += 1;
      const blockedBy = await fetchIssueBlockedBy(repo, issueNumber);
      result.set(
        String(issueNumber),
        blockedBy.map((entry) => String(entry.number)),
      );
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, issueNumbers.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return result;
}
