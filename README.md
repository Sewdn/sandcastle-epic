# @sewdn/sandcastle-epic

Epic-scoped orchestration layer for [@ai-hero/sandcastle](https://www.npmjs.com/package/@ai-hero/sandcastle). Runs a plan → cluster → implement → review → merge loop for GitHub issues grouped by epic, using Sandcastle sandboxes and agent harnesses.

Requires [Bun](https://bun.sh) on the host (uses Bun shell and spawn APIs).

## Install

```bash
bun add @sewdn/sandcastle-epic @ai-hero/sandcastle
```

## Usage

Create a `.sandcastle/` directory in your repo with prompts and env, then wire a small entry script:

```ts
import { createConfiguredEpicContext, runEpicLoopWithMessage } from "@sewdn/sandcastle-epic";

const ctx = createConfiguredEpicContext({
  epic: process.env.SANDCASTLE_EPIC ?? "a0",
  repoRoot: process.cwd(),
  sandcastleDir: import.meta.dir,
  maxIterations: 10,
});

await runEpicLoopWithMessage(ctx);
```

For multi-epic sequences without merging to `main` between epics, use `runLongEpicOrchestration` and `resolveLongRunConfig`.

See Sandcastle docs for sandbox image build, `CURSOR_API_KEY`, and `GH_TOKEN` setup.

## Development

```bash
bun install
bun run typecheck
bun test
bun run build
```

## License

MIT
