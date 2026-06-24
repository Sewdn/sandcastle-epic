import {
  cpSync,
  existsSync,
  lstatSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
} from "node:fs";
import path from "node:path";

function resolveRepoRoot(repoRoot: string): string {
  try {
    return realpathSync(repoRoot);
  } catch {
    return path.resolve(repoRoot);
  }
}

function listPackageEntries(nodeModulesDir: string): string[] {
  const entries: string[] = [];
  for (const name of readdirSync(nodeModulesDir)) {
    if (name === ".bin") {
      continue;
    }
    const entry = path.join(nodeModulesDir, name);
    entries.push(entry);
    if (!name.startsWith("@")) {
      continue;
    }
    try {
      for (const pkg of readdirSync(entry)) {
        entries.push(path.join(entry, pkg));
      }
    } catch {
      // Skip unreadable scope directories.
    }
  }
  return entries;
}

function isBrokenSymlink(entry: string): boolean {
  try {
    if (!lstatSync(entry).isSymbolicLink()) {
      return false;
    }
    realpathSync(entry);
    return false;
  } catch {
    return true;
  }
}

function resolveSymlinkTarget(entry: string): string | null {
  let link: string;
  try {
    link = readlinkSync(entry);
  } catch {
    return null;
  }

  const absolute = path.isAbsolute(link) ? link : path.resolve(path.dirname(entry), link);
  try {
    return realpathSync(absolute);
  } catch {
    return null;
  }
}

function materializeIfExternalSymlink(
  entry: string,
  resolvedRepoRoot: string,
): boolean {
  let stat;
  try {
    stat = lstatSync(entry);
  } catch {
    return false;
  }
  if (!stat.isSymbolicLink()) {
    return false;
  }

  const target = resolveSymlinkTarget(entry);
  if (target === null) {
    return false;
  }

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

/** Drop dead node_modules symlinks so later scans do not trip over missing targets. */
export function pruneBrokenSymlinks(repoRoot: string): string[] {
  const nodeModulesDir = path.join(repoRoot, "node_modules");
  if (!existsSync(nodeModulesDir)) {
    return [];
  }

  const pruned: string[] = [];
  for (const entry of listPackageEntries(nodeModulesDir)) {
    if (!isBrokenSymlink(entry)) {
      continue;
    }
    rmSync(entry, { force: true });
    pruned.push(path.relative(repoRoot, entry));
  }
  return pruned;
}

/** Replace bun-linked packages with real copies so sandbox node_modules copies stay self-contained. */
export function materializeLinkedPackages(repoRoot: string): string[] {
  const nodeModulesDir = path.join(repoRoot, "node_modules");
  if (!existsSync(nodeModulesDir)) {
    return [];
  }

  const resolvedRepoRoot = resolveRepoRoot(repoRoot);
  const materialized: string[] = [];
  for (const entry of listPackageEntries(nodeModulesDir)) {
    if (materializeIfExternalSymlink(entry, resolvedRepoRoot)) {
      materialized.push(path.relative(repoRoot, entry));
    }
  }
  return materialized;
}
