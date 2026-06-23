export function integrationBranchForEpic(epic: string): string {
  return `integrate/epic-${epic}`;
}

export function epicLabelForEpic(epic: string): string {
  return `epic:${epic}`;
}

/** Parse `a0,a1` or `all` into an ordered epic slug list supplied by the host project. */
export function parseEpicList(
  input: string | undefined,
  defaultEpics: readonly string[],
): string[] {
  const normalized = input?.trim().toLowerCase();
  if (normalized === undefined || normalized.length === 0 || normalized === "all") {
    return [...defaultEpics];
  }

  return normalized
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function validateEpicSequence(epics: readonly string[]): void {
  if (epics.length === 0) {
    throw new Error("Epic list is empty. Set SANDCASTLE_EPICS=a0,a1 or SANDCASTLE_EPICS=all.");
  }

  const seen = new Set<string>();
  for (const epic of epics) {
    if (!/^a\d+$/.test(epic)) {
      throw new Error(`Invalid epic slug '${epic}'. Expected format a0, a1, …`);
    }
    if (seen.has(epic)) {
      throw new Error(`Duplicate epic slug '${epic}' in sequence.`);
    }
    seen.add(epic);
  }
}
