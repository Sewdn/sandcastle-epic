import { describe, expect, test } from "bun:test";
import {
  branchFromRef,
  isSandcastleIntegrationBranch,
  isSandcastleWorktreePath,
  parseGitWorktreePorcelain,
  sandcastleWorktreesRoot,
} from "./worktrees.js";

describe("parseGitWorktreePorcelain", () => {
  test("parses main and linked worktrees", () => {
    const output = `worktree /repo
HEAD abc111
branch refs/heads/integrate/epic-a1

worktree /repo/.sandcastle/worktrees/feature-19-auth
HEAD def222
branch refs/heads/feature/19-auth-middleware-resolve-current
`;

    expect(parseGitWorktreePorcelain(output)).toEqual([
      {
        path: "/repo",
        head: "abc111",
        branch: "integrate/epic-a1",
      },
      {
        path: "/repo/.sandcastle/worktrees/feature-19-auth",
        head: "def222",
        branch: "feature/19-auth-middleware-resolve-current",
      },
    ]);
  });

  test("records detached HEAD worktrees", () => {
    const output = `worktree /repo/.sandcastle/worktrees/detached-run
HEAD abc111
detached
`;

    expect(parseGitWorktreePorcelain(output)).toEqual([
      {
        path: "/repo/.sandcastle/worktrees/detached-run",
        head: "abc111",
        branch: null,
      },
    ]);
  });
});

describe("isSandcastleWorktreePath", () => {
  test("matches paths under sandcastle worktrees root", () => {
    const sandcastleDir = "/repo/.sandcastle";
    expect(isSandcastleWorktreePath("/repo/.sandcastle/worktrees/feature-19", sandcastleDir)).toBe(
      true,
    );
    expect(isSandcastleWorktreePath("/repo/.sandcastle/worktrees", sandcastleDir)).toBe(true);
    expect(isSandcastleWorktreePath("/repo", sandcastleDir)).toBe(false);
  });
});

describe("branchFromRef", () => {
  test("strips refs/heads prefix", () => {
    expect(branchFromRef("refs/heads/feature/19-auth")).toBe("feature/19-auth");
  });
});

describe("isSandcastleIntegrationBranch", () => {
  test("detects integrate/epic branches", () => {
    expect(isSandcastleIntegrationBranch("integrate/epic-a7")).toBe(true);
    expect(isSandcastleIntegrationBranch("feature/55-implement")).toBe(false);
    expect(isSandcastleIntegrationBranch(null)).toBe(false);
  });
});

describe("sandcastleWorktreesRoot", () => {
  test("joins sandcastle dir with worktrees", () => {
    expect(sandcastleWorktreesRoot("/repo/.sandcastle")).toBe("/repo/.sandcastle/worktrees");
  });
});
