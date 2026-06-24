import { existsSync } from "node:fs";
import path from "node:path";
import { $ } from "bun";
import { materializeLinkedPackages, pruneBrokenSymlinks } from "./deps-materialize.js";

const SVC_PRISMA_DIR = "packages/svc-prisma";
const LOCKFILE_UPDATE_MESSAGE = "chore(sandcastle): refresh lockfile after merge";

/** Regenerate Prisma client for the host platform after Linux sandbox node_modules copies. */
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
  console.log("  Running host bun install (feeds sandbox node_modules copy)…");
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
    console.log(`  Materialized linked package(s) for sandbox copy: ${materialized.join(", ")}`);
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
