import { cpSync, existsSync, lstatSync, readdirSync, realpathSync, rmSync } from "node:fs";
import path from "node:path";

function listPackageEntries(nodeModulesDir: string): string[] {
  const entries: string[] = [];
  for (const name of readdirSync(nodeModulesDir)) {
    if (name === ".bin") {
      continue;
    }
    const entry = path.join(nodeModulesDir, name);
    entries.push(entry);
    if (name.startsWith("@")) {
      for (const pkg of readdirSync(entry)) {
        entries.push(path.join(entry, pkg));
      }
    }
  }
  return entries;
}

function materializeIfExternalSymlink(entry: string, repoRoot: string): boolean {
  let stat;
  try {
    stat = lstatSync(entry);
  } catch {
    return false;
  }
  if (!stat.isSymbolicLink()) {
    return false;
  }

  let target: string;
  try {
    target = realpathSync(entry);
  } catch {
    return false;
  }
  const resolvedRepoRoot = realpathSync(repoRoot);
  const repoRootWithSep = resolvedRepoRoot.endsWith(path.sep)
    ? resolvedRepoRoot
    : `${resolvedRepoRoot}${path.sep}`;
  if (target === resolvedRepoRoot || target.startsWith(repoRootWithSep)) {
    return false;
  }

  const staging = `${entry}.sandcastle-materialize`;
  cpSync(target, staging, { dereference: true, recursive: true });
  rmSync(entry, { recursive: true, force: true });
  cpSync(staging, entry, { recursive: true });
  rmSync(staging, { recursive: true, force: true });
  return true;
}

/** Replace bun-linked packages with real copies so sandbox node_modules copies stay self-contained. */
export function materializeLinkedPackages(repoRoot: string): string[] {
  const nodeModulesDir = path.join(repoRoot, "node_modules");
  if (!existsSync(nodeModulesDir)) {
    return [];
  }

  const materialized: string[] = [];
  for (const entry of listPackageEntries(nodeModulesDir)) {
    if (materializeIfExternalSymlink(entry, repoRoot)) {
      materialized.push(path.relative(repoRoot, entry));
    }
  }
  return materialized;
}
