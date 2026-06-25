import { describe, expect, test } from "bun:test";
import { resolveConfig } from "./config.js";
import type { EpicSandcastleConfig } from "./types.js";

const baseConfig: EpicSandcastleConfig = {
  epic: "a0",
  repoRoot: "/repo",
  sandcastleDir: "/repo/.sandcastle",
  maxIterations: 10,
};

describe("resolveConfig", () => {
  test("defaults every agent role to the Cursor composer harness", () => {
    const resolved = resolveConfig(baseConfig);

    expect(resolved.agents).toEqual({
      planner: { harness: "cursor", model: "composer-2.5-fast", verboseLogging: false, skills: [] },
      implementer: {
        harness: "cursor",
        model: "composer-2.5-fast",
        verboseLogging: false,
        skills: [],
      },
      reviewer: {
        harness: "cursor",
        model: "composer-2.5-fast",
        verboseLogging: false,
        skills: [],
      },
      resolver: {
        harness: "cursor",
        model: "composer-2.5-fast",
        verboseLogging: false,
        skills: [],
      },
      merger: { harness: "cursor", model: "composer-2.5-fast", verboseLogging: false, skills: [] },
      supervisor: {
        harness: "cursor",
        model: "composer-2.5-fast",
        verboseLogging: false,
        skills: [],
      },
    });
  });

  test("applies shared defaults and per-role overrides", () => {
    const resolved = resolveConfig({
      ...baseConfig,
      agents: {
        default: {
          harness: "codex",
          model: "gpt-5.3-codex-high-fast",
          verboseLogging: true,
          skills: ["/git-commits"],
        },
        reviewer: { harness: "cursor", model: "composer-2.5-fast", verboseLogging: false },
        merger: { model: "gpt-5.5-medium", skills: ["skills/dora/SKILL.md"] },
      },
    });

    expect(resolved.agents.implementer).toEqual({
      harness: "codex",
      model: "gpt-5.3-codex-high-fast",
      verboseLogging: true,
      skills: ["/git-commits"],
    });
    expect(resolved.agents.reviewer).toEqual({
      harness: "cursor",
      model: "composer-2.5-fast",
      verboseLogging: false,
      skills: ["/git-commits"],
    });
    expect(resolved.agents.merger).toEqual({
      harness: "codex",
      model: "gpt-5.5-medium",
      verboseLogging: true,
      skills: ["/git-commits", "skills/dora/SKILL.md"],
    });
  });

  test("treats legacy cursorModel as the default model", () => {
    const resolved = resolveConfig({
      ...baseConfig,
      cursorModel: "gpt-5.5-medium",
    });

    expect(resolved.agents.planner).toEqual({
      harness: "cursor",
      model: "gpt-5.5-medium",
      verboseLogging: false,
      skills: [],
    });
  });
});
