import { existsSync } from "node:fs";
import path from "node:path";
import { $ } from "bun";
import { materializeLinkedPackages, pruneBrokenSymlinks } from "./deps-materialize.js";

const SVC_PRISMA_DIR = "packages/svc-prisma";
const LOCKFILE_UPDATE_MESSAGE = "chore(sandcastle): refresh lockfile after merge";

/** Paths that affect the shared host node_modules mount when changed on a feature branch. */
export function isDependencyManifestPath(filePath: string): boolean {
  return (
    filePath === "bun.lock" ||
    filePath === "package.json" ||
    /^packages\/[^/]+\/package\.json$/.test(filePath) ||
    /^apps\/[^/]+\/package\.json$/.test(filePath)
  );
}

/** Paths that exist at `ref` in git (skip new manifests not yet on integration). */
export async function dependencyManifestPathsOnRef(
  repoRoot: string,
  ref: string,
  paths: readonly string[],
): Promise<string[]> {
  const known: string[] = [];
  for (const manifestPath of paths) {
    const result = await $`git cat-file -e ${ref}:${manifestPath}`.cwd(repoRoot).quiet().nothrow();
    if (result.exitCode === 0) {
      known.push(manifestPath);
    }
  }
  return known;
}

/** Dependency manifest paths changed on `branch` since it diverged from `base`. */
export async function listDependencyFileChanges(
  repoRoot: string,
  base: string,
  branch: string,
): Promise<string[]> {
  const result = await $`git diff --name-only ${base}...${branch}`.cwd(repoRoot).quiet().nothrow();
  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    throw new Error(
      `Failed to diff dependency files for ${branch}${stderr ? `: ${stderr}` : ""}`,
    );
  }

  return result.stdout
    .toString()
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && isDependencyManifestPath(line));
}

/**
 * After implement, refresh host node_modules from feature-branch manifests so review sandboxes
 * can import newly added packages. Restores integration-branch manifest files afterward.
 */
export async function refreshHostDependenciesForReview(
  repoRoot: string,
  integrationBranch: string,
  branches: readonly string[],
): Promise<void> {
  const paths = new Set<string>();
  for (const branch of branches) {
    for (const manifestPath of await listDependencyFileChanges(
      repoRoot,
      integrationBranch,
      branch,
    )) {
      paths.add(manifestPath);
    }
  }

  if (paths.size === 0) {
    return;
  }

  const pathList = [...paths].sort();
  console.log(
    `  Feature branch(es) changed dependency manifests — refreshing host node_modules for review…`,
  );
  console.log(`    ${pathList.join(", ")}`);

  for (const branch of branches) {
    const branchPaths = await listDependencyFileChanges(repoRoot, integrationBranch, branch);
    if (branchPaths.length === 0) {
      continue;
    }

    const checkout = await $`git checkout ${branch} -- ${branchPaths}`.cwd(repoRoot).quiet().nothrow();
    if (checkout.exitCode !== 0) {
      const stderr = checkout.stderr.toString().trim();
      throw new Error(
        `Failed to checkout dependency manifests from ${branch}${stderr ? `: ${stderr}` : ""}`,
      );
    }
  }

  try {
    await installHostDependencies(repoRoot);
  } finally {
    const restorePaths = await dependencyManifestPathsOnRef(
      repoRoot,
      integrationBranch,
      pathList,
    );
    const skipped = pathList.filter((manifestPath) => !restorePaths.includes(manifestPath));
    if (skipped.length > 0) {
      console.log(
        `  Skipping restore for new manifest(s) not on ${integrationBranch}: ${skipped.join(", ")}`,
      );
    }

    if (restorePaths.length === 0) {
      return;
    }

    const restore = await $`git checkout ${integrationBranch} -- ${restorePaths}`
      .cwd(repoRoot)
      .quiet()
      .nothrow();
    if (restore.exitCode !== 0) {
      const stderr = restore.stderr.toString().trim();
      console.warn(
        `  Warning: failed to restore integration dependency manifests${stderr ? `: ${stderr}` : ""}`,
      );
    }
  }
}

/** Regenerate Prisma client for the host platform after sandbox node_modules bind-mount. */
async function regenerateHostPrismaClient(repoRoot: string): Promise<void> {
  const prismaDir = path.join(repoRoot, SVC_PRISMA_DIR);
  const schemaPath = path.join(prismaDir, "prisma", "schema.prisma");
  if (!existsSync(schemaPath)) {
    return;
  }

  console.log("  Regenerating Prisma client for host platform…");
  const result = await $`bun run db:generate`.cwd(prismaDir).quiet().nothrow();
  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    throw new Error(`Host Prisma generate failed in ${prismaDir}${stderr ? `: ${stderr}` : ""}`);
  }
}

/** Refresh host node_modules and native Prisma engines after sandbox work. */
export async function installHostDependencies(repoRoot: string): Promise<void> {
  console.log("  Running host bun install (shared sandbox node_modules mount)…");
  const result = await $`bun install --ignore-scripts`.cwd(repoRoot).quiet().nothrow();
  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    throw new Error(`Host bun install failed in ${repoRoot}${stderr ? `: ${stderr}` : ""}`);
  }

  const pruned = pruneBrokenSymlinks(repoRoot);
  if (pruned.length > 0) {
    console.log(`  Removed broken node_modules symlink(s): ${pruned.join(", ")}`);
  }

  const materialized = materializeLinkedPackages(repoRoot);
  if (materialized.length > 0) {
    console.log(`  Materialized linked package(s) for sandbox mount: ${materialized.join(", ")}`);
  }

  await regenerateHostPrismaClient(repoRoot);
}

/** Ensure host lockfile and node_modules match the current integration branch before a sandbox starts. */
export async function reconcileHostDependencies(repoRoot: string): Promise<void> {
  console.log("  Reconciling host dependencies and lockfile…");

  const installResult = await $`bun install --lockfile-only`.cwd(repoRoot).quiet().nothrow();
  if (installResult.exitCode !== 0) {
    const stderr = installResult.stderr.toString().trim();
    throw new Error(`Host lockfile refresh failed in ${repoRoot}${stderr ? `: ${stderr}` : ""}`);
  }

  const lockfileChanged =
    (await $`git diff --quiet -- bun.lock`.cwd(repoRoot).nothrow()).exitCode !== 0;

  if (lockfileChanged) {
    console.log("  bun.lock changed after merge; committing lockfile update…");
    await $`git add bun.lock`.cwd(repoRoot);
    const commitResult = await $`git commit -m ${LOCKFILE_UPDATE_MESSAGE}`.cwd(repoRoot).nothrow();
    if (commitResult.exitCode !== 0) {
      const stderr = commitResult.stderr.toString().trim();
      throw new Error(`Failed to commit refreshed bun.lock${stderr ? `: ${stderr}` : ""}`);
    }
  }

  const frozenResult = await $`bun install --frozen-lockfile --ignore-scripts`
    .cwd(repoRoot)
    .quiet()
    .nothrow();
  if (frozenResult.exitCode !== 0) {
    const stderr = frozenResult.stderr.toString().trim();
    throw new Error(
      `Host frozen install failed after lockfile reconciliation${stderr ? `: ${stderr}` : ""}`,
    );
  }

  await installHostDependencies(repoRoot);
}
