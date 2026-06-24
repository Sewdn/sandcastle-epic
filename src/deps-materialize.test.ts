import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { materializeLinkedPackages, pruneBrokenSymlinks } from "./deps-materialize.js";

let repoRoot = "";
let externalPackage = "";

beforeEach(() => {
  repoRoot = mkdtempSync(path.join(tmpdir(), "sandcastle-deps-"));
  externalPackage = mkdtempSync(path.join(tmpdir(), "sandcastle-linked-pkg-"));

  writeFileSync(
    path.join(externalPackage, "package.json"),
    JSON.stringify({ name: "@sewdn/sandcastle-epic", version: "0.0.0-test" }),
  );
  writeFileSync(path.join(externalPackage, "index.js"), "export const ok = true;\n");

  writeFileSync(
    path.join(repoRoot, "package.json"),
    JSON.stringify({
      name: "host-repo",
      dependencies: { "@sewdn/sandcastle-epic": "link:@sewdn/sandcastle-epic" },
    }),
  );

  const nodeModules = path.join(repoRoot, "node_modules", "@sewdn");
  mkdirSync(nodeModules, { recursive: true });
  symlinkSync(externalPackage, path.join(nodeModules, "sandcastle-epic"));
});

afterEach(() => {
  rmSync(repoRoot, { force: true, recursive: true });
  rmSync(externalPackage, { force: true, recursive: true });
});

test("materializeLinkedPackages copies bun-linked packages into node_modules", () => {
  const materialized = materializeLinkedPackages(repoRoot);

  expect(materialized).toEqual(["node_modules/@sewdn/sandcastle-epic"]);
  const linkedPath = path.join(repoRoot, "node_modules", "@sewdn", "sandcastle-epic");
  expect(lstatSync(linkedPath).isSymbolicLink()).toBe(false);
  expect(readFileSync(path.join(linkedPath, "index.js"), "utf8")).toContain("ok = true");
});

test("pruneBrokenSymlinks removes dead symlinks without throwing", () => {
  const broken = path.join(repoRoot, "node_modules", "@verbouwing", "sandcastle-epic");
  mkdirSync(path.dirname(broken), { recursive: true });
  symlinkSync(path.join(repoRoot, "packages", "missing-pkg"), broken);

  const pruned = pruneBrokenSymlinks(repoRoot);

  expect(pruned).toEqual(["node_modules/@verbouwing/sandcastle-epic"]);
  expect(existsSync(broken)).toBe(false);
});

test("materializeLinkedPackages leaves in-repo workspace symlinks untouched", () => {
  const workspacePackage = path.join(repoRoot, "packages", "local-pkg");
  mkdirSync(workspacePackage, { recursive: true });
  writeFileSync(path.join(workspacePackage, "package.json"), JSON.stringify({ name: "local-pkg" }));

  const workspaceLink = path.join(repoRoot, "node_modules", "local-pkg");
  mkdirSync(path.dirname(workspaceLink), { recursive: true });
  symlinkSync(workspacePackage, workspaceLink);

  const materialized = materializeLinkedPackages(repoRoot);

  expect(materialized).toEqual(["node_modules/@sewdn/sandcastle-epic"]);
  expect(lstatSync(workspaceLink).isSymbolicLink()).toBe(true);
  expect(existsSync(path.join(workspaceLink, "package.json"))).toBe(true);
});
