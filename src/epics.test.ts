import { describe, expect, test } from "bun:test";
import { integrationBranchForEpic, parseEpicList, validateEpicSequence } from "./epics.js";

const hostEpics = ["a0", "a1", "a2"] as const;

describe("parseEpicList", () => {
  test("defaults to the host-provided epic sequence", () => {
    expect(parseEpicList(undefined, hostEpics)).toEqual([...hostEpics]);
    expect(parseEpicList("all", hostEpics)).toEqual([...hostEpics]);
  });

  test("parses comma-separated slugs", () => {
    expect(parseEpicList("a0,a2, a3", hostEpics)).toEqual(["a0", "a2", "a3"]);
  });
});

describe("validateEpicSequence", () => {
  test("rejects empty and duplicate slugs", () => {
    expect(() => validateEpicSequence([])).toThrow(/empty/i);
    expect(() => validateEpicSequence(["a0", "a0"])).toThrow(/duplicate/i);
    expect(() => validateEpicSequence(["AA0"])).toThrow(/invalid/i);
    expect(() => validateEpicSequence(["aa-5"])).toThrow(/invalid/i);
  });

  test("accepts backlog-defined slugs including suffix variants", () => {
    const knownEpics = ["aa0", "aa5", "aa5a", "aa6"];
    expect(() => validateEpicSequence(["aa5a"], { knownEpics })).not.toThrow();
    expect(() => validateEpicSequence(["aa0", "aa5a"], { knownEpics })).not.toThrow();
    expect(() => validateEpicSequence(["x0"], { knownEpics })).toThrow(/not defined in the issue backlog/i);
  });

  test("accepts format-valid slugs when no backlog is supplied", () => {
    expect(() => validateEpicSequence(["aa0", "aa5a"])).not.toThrow();
  });
});

describe("integrationBranchForEpic", () => {
  test("maps slug to integrate branch name", () => {
    expect(integrationBranchForEpic("a0")).toBe("integrate/epic-a0");
    expect(integrationBranchForEpic("aa0")).toBe("integrate/epic-aa0");
  });
});
