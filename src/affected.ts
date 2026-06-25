import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { $ } from "bun";

const PACKAGE_MARKERS = ["packages/", "apps/"] as const;

function readPackageName(packageJsonPath: string): string | null {
  try {
    const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { name?: string };
    return typeof parsed.name === "string" && parsed.name.length > 0 ? parsed.name : null;
  } catch {
    return null;
  }
}

function packageRootForChangedFile(repoRoot: string, changedPath: string): string | null {
  for (const marker of PACKAGE_MARKERS) {
    const index = changedPath.indexOf(marker);
    if (index < 0) {
      continue;
    }

    const rest = changedPath.slice(index + marker.length);
    const segment = rest.split("/")[0];
    if (!segment) {
      continue;
    }

    const root = path.join(repoRoot, marker, segment);
    if (existsSync(path.join(root, "package.json"))) {
      return root;
    }
  }

  return null;
}

/** Paths touched between base and head refs (three-dot diff). */
export async function changedPathsBetweenRefs(
  repoRoot: string,
  baseRef: string,
  headRef: string,
): Promise<readonly string[]> {
  const result = await $`git diff --name-only ${baseRef}...${headRef}`.cwd(repoRoot).quiet().nothrow();
  if (result.exitCode !== 0) {
    return [];
  }

  return result.stdout
    .toString()
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** Package names (@verbouwing/…) touched by a branch relative to the integration branch. */
export async function affectedPackageNames(
  repoRoot: string,
  integrationBranch: string,
  featureBranch: string,
): Promise<readonly string[]> {
  const changed = await changedPathsBetweenRefs(repoRoot, integrationBranch, featureBranch);
  const names = new Set<string>();

  for (const file of changed) {
    const root = packageRootForChangedFile(repoRoot, file);
    if (!root) {
      continue;
    }

    const name = readPackageName(path.join(root, "package.json"));
    if (name) {
      names.add(name);
    }
  }

  return [...names].sort();
}

export function formatAffectedValidationScope(packages: readonly string[]): string {
  if (packages.length === 0) {
    return "No workspace package roots detected in the branch diff — run scoped checks only on paths you touched.";
  }

  const filters = packages.map((pkg) => `--filter ${pkg}`).join(" ");
  return [
    "Impacted workspace packages (from branch diff):",
    ...packages.map((pkg) => `- ${pkg}`),
    "",
    "Run validation scoped to these packages only — do **not** run root `bun run typecheck` or `bun run test` first:",
    "",
    "```bash",
    `bun run ${filters} lint`,
    `bun run ${filters} typecheck`,
    `bun run ${filters} test`,
    "```",
    "",
    "Root `bun run format` is fine when you changed formatted files.",
  ].join("\n");
}
