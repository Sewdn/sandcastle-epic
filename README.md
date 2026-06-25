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

## Host environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `SANDCASTLE_PARALLEL_CLUSTERS` | on | Run independent planner clusters concurrently (`0` = always sequential) |
| `SANDCASTLE_PARALLEL_CLUSTER_LIMIT` | `2` | Max concurrent clusters when parallel is on (each cluster = one sandbox + implement/review/merge) |
| `SANDCASTLE_SUPERVISOR` | on | Invoke supervisor agent on stalls (`0` to disable) |
| `SANDCASTLE_AGENT_IDLE_TIMEOUT_SECONDS` | 1800 | Agent idle timeout per run |

### Shared sandbox mounts

Each sandbox bind-mounts the host `node_modules/` and `.dora/` directories (no per-worktree copy). Run `bun install` on the host integration branch before long runs.

The orchestrator calls `dora index` on the host after implement, review, and merge steps so all sandboxes share one up-to-date index.

### Supervisor agent

When pending merges stall for multiple iterations, or the loop nears `maxIterations` with open work, the orchestrator invokes a **supervisor** agent (prompt: `supervisor-prompt.md`) with recent log excerpts to diagnose and fix host/config issues.

## Development

```bash
bun install
bun run typecheck
bun test
bun run build
npm publish --access public   # @sewdn org
```

## License

MIT
