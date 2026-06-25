import { describe, expect, test } from "bun:test";
import { formatInterventionLogRefs } from "./intervention.js";

describe("formatInterventionLogRefs", () => {
  test("lists paths and shell hints without embedding log contents", () => {
    const refs = formatInterventionLogRefs(["/repo/.sandcastle/logs/implement-161.log"]);
    expect(refs).toContain("implement-161.log");
    expect(refs).toContain("tail -n 60");
    expect(refs).toContain("rg -n");
    expect(refs).not.toContain("HTTP 502");
  });

  test("handles empty log list", () => {
    expect(formatInterventionLogRefs([])).toContain("no Sandcastle logs");
  });
});
