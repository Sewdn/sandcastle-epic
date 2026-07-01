/** Lowercase slug safe for `integrate/epic-*` branches and `epic:*` labels. */
export const EPIC_SLUG_PATTERN = /^[a-z][a-z0-9]*$/;

export function isValidEpicSlug(epic: string): boolean {
  return EPIC_SLUG_PATTERN.test(epic);
}

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

export type ValidateEpicSequenceOptions = {
  /** When set, each epic must be declared in the host issue backlog YAML. */
  readonly knownEpics?: readonly string[];
};

export function validateEpicSequence(
  epics: readonly string[],
  options: ValidateEpicSequenceOptions = {},
): void {
  if (epics.length === 0) {
    throw new Error(
      "Epic list is empty. Set SANDCASTLE_EPICS=a0,a1, SANDCASTLE_PHASE=aa, or SANDCASTLE_EPICS=all.",
    );
  }

  const knownEpics =
    options.knownEpics !== undefined && options.knownEpics.length > 0
      ? new Set(options.knownEpics)
      : null;

  const seen = new Set<string>();
  for (const epic of epics) {
    if (seen.has(epic)) {
      throw new Error(`Duplicate epic slug '${epic}' in sequence.`);
    }
    seen.add(epic);

    if (knownEpics !== null) {
      if (!knownEpics.has(epic)) {
        throw new Error(
          `Epic '${epic}' is not defined in the issue backlog. Known epics: ${options.knownEpics!.join(", ")}`,
        );
      }
      continue;
    }

    if (!isValidEpicSlug(epic)) {
      throw new Error(
        `Invalid epic slug '${epic}'. Use lowercase letters and digits (e.g. a0, aa5a).`,
      );
    }
  }
}
