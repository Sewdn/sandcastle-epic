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
    expect(() => validateEpicSequence(["x0"])).toThrow(/invalid/i);
  });

  test("accepts Phase AA slugs", () => {
    expect(() => validateEpicSequence(["aa0", "aa1"])).not.toThrow();
  });
});

describe("integrationBranchForEpic", () => {
  test("maps slug to integrate branch name", () => {
    expect(integrationBranchForEpic("a0")).toBe("integrate/epic-a0");
    expect(integrationBranchForEpic("aa0")).toBe("integrate/epic-aa0");
  });
});
