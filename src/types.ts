import { z } from "zod";
import type { ProjectMap } from "./project-map.js";

export const issueSchema = z.object({
  id: z.string(),
  title: z.string(),
  branch: z.string(),
});

export const planSchema = z.object({
  issues: z.array(issueSchema),
});

export const clusterSkillsSchema = z
  .object({
    implementation: z.array(z.string()).optional(),
    review: z.array(z.string()).optional(),
  })
  .optional();

/** Unified planner output — dependency review plus implementer clusters. */
export const epicPlanSchema = z.object({
  clusters: z.array(
    z.object({
      reason: z.string(),
      skills: clusterSkillsSchema,
      issues: z.array(issueSchema),
    }),
  ),
});

export const clusterSchema = z.object({
  clusters: z.array(
    z.object({
      reason: z.string(),
      skills: clusterSkillsSchema,
      issues: z.array(issueSchema),
    }),
  ),
});

/** Legacy shape from earlier cluster planner iterations. */
export const legacyClusterSchema = z.object({
  sessions: z.array(
    z.object({
      sessionId: z.string().optional(),
      reason: z.string(),
      issues: z.array(issueSchema),
    }),
  ),
});

export type PlannedIssue = z.infer<typeof issueSchema>;
export type IssueCluster = z.infer<typeof clusterSchema>["clusters"][number];

export type PromptPaths = {
  plan: string;
  cluster: string;
  implement: string;
  implementCluster: string;
  review: string;
  reviewCluster: string;
  merge: string;
  mergeIntegration: string;
  resolve: string;
  supervisor: string;
};

export type AgentRole =
  | "planner"
  | "implementer"
  | "reviewer"
  | "resolver"
  | "merger"
  | "supervisor";

export type AgentHarness = "cursor" | "codex" | "claudeCode" | "pi" | "opencode" | "copilot";

export const SUPPORTED_AGENT_MODELS = [
  "auto",
  "claude-4.6-sonnet-medium-thinking",
  "claude-fable-5-thinking-high",
  "claude-opus-4-8-thinking-high",
  "composer-2.5-fast",
  "gemini-3.1-pro",
  "gpt-5.3-codex-high-fast",
  "gpt-5.5-medium",
  "grok-build-0.1",
  "zai/glm-5.2",
] as const;

export type AgentModel = (typeof SUPPORTED_AGENT_MODELS)[number] | `zai/${string}`;

export type AgentHarnessConfig = {
  harness: AgentHarness;
  model: AgentModel;
  verboseLogging: boolean;
  skills: readonly string[];
};

export type AgentConfigOverrides = {
  default?: Partial<AgentHarnessConfig>;
} & Partial<Record<AgentRole, Partial<AgentHarnessConfig>>>;

export type EpicSandcastleConfig = {
  /** Epic slug, e.g. `a0` → `integrate/epic-a0` and label `epic:a0`. */
  epic: string;
  /** Repository root (host cwd when Sandcastle runs). */
  repoRoot: string;
  /** Absolute path to `.sandcastle` (prompts, gitconfig, Dockerfile). */
  sandcastleDir: string;
  /** @deprecated Use `agents.default.model` or per-role `agents` overrides. */
  cursorModel?: AgentModel;
  /** Default and per-role agent harness/model configuration. */
  agents?: AgentConfigOverrides;
  maxIterations: number;
  /** GitHub-derived project map — epic completion and planner context. */
  projectMap?: ProjectMap;
  /** Override default prompt paths (repo-root-relative). */
  prompts?: Partial<PromptPaths>;
};

export type ResolvedEpicConfig = EpicSandcastleConfig & {
  integrationBranch: string;
  epicLabel: string;
  sandboxImage: string;
  prompts: PromptPaths;
  agents: Record<AgentRole, AgentHarnessConfig>;
};

export type LongRunSandcastleConfig = {
  /** Ordered epic slugs, e.g. `["a0", "a1"]`. */
  epics: readonly string[];
  /** Push integration branches after epic completion and when creating the next epic branch. */
  pushRemotes: boolean;
  /** When set, longrun is limited to epics from this backlog phase. */
  phase?: string;
  /** Full cross-phase epic order for integration-branch handoff lookups. */
  canonicalEpicSequence?: readonly string[];
};

export type EpicLoopResult = {
  readonly completed: boolean;
  readonly reason: "no-agent-work" | "max-iterations" | "pending-merges";
  readonly iterationsRun: number;
};
