import { $ } from "bun";
import type { EpicContext } from "./context.js";

export async function ensureDockerRuntime(ctx: EpicContext): Promise<void> {
  const { sandboxImage } = ctx.config;
  const daemon = (await $`docker info`.quiet().nothrow()).exitCode === 0;
  if (!daemon) {
    throw new Error(
      "Docker daemon is not reachable. Start OrbStack or Docker Desktop, then retry.",
    );
  }

  const exists = (await $`docker image inspect ${sandboxImage}`.quiet().nothrow()).exitCode === 0;
  if (!exists) {
    throw new Error(
      `Docker image '${sandboxImage}' not found. Build it from the repo root:\n` +
        `  bun run sandcastle:build-image`,
    );
  }
}
