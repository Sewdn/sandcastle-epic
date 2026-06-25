import { describe, expect, test } from "bun:test";
import { isDependencyManifestPath } from "./deps.js";

describe("isDependencyManifestPath", () => {
  test("matches root and workspace package manifests", () => {
    expect(isDependencyManifestPath("bun.lock")).toBe(true);
    expect(isDependencyManifestPath("package.json")).toBe(true);
    expect(isDependencyManifestPath("packages/svc-prisma/package.json")).toBe(true);
    expect(isDependencyManifestPath("apps/api-elysia-platform/package.json")).toBe(true);
  });

  test("rejects unrelated paths", () => {
    expect(isDependencyManifestPath("packages/svc-prisma/src/index.ts")).toBe(false);
    expect(isDependencyManifestPath("apps/nested/api/package.json")).toBe(false);
    expect(isDependencyManifestPath("node_modules/foo/package.json")).toBe(false);
  });
});
