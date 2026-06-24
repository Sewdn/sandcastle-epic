export { configureHostGit, DEFAULT_AGENT_CONFIG, resolveConfig } from "./config.js";
export { installHostDependencies } from "./deps.js";
export {
  clearEpicCompleted,
  filterEpicsToRun,
  isEpicCompleted,
  loadCompletedEpics,
  markEpicCompleted,
  priorCompletedEpic,
} from "./completed-epics.js";
export { createConfiguredEpicContext, createEpicContext, type EpicContext } from "./context.js";
export { ensureDockerRuntime } from "./docker.js";
export {
  closeIntegratedIssue,
  closeMergedIssue,
  countCommitsAhead,
  discardHostMergeBlockers,
  ensureIntegrationBranch,
  ensureIssueBranches,
  featureBranchForIssue,
  integrationMentionsIssue,
  isFastForwardMerge,
  issuesWithCommits,
  listPendingMergeIssues,
  mergeIssueBranchesOnHost,
  parseFeatureBranchIssueId,
} from "./git.js";
export {
  filterAlreadyIntegratedIssues,
  isIssueAlreadyIntegrated,
  reconcileMergedOpenIssues,
} from "./reconcile.js";
export {
  clusterLabel,
  clusterPromptArgs,
  clustersFromIssues,
  implementerRunName,
  logClusterValidationIssues,
  parseClusterOutput,
  validateClusters,
} from "./cluster/helpers.js";
export { planClusters } from "./cluster/planner.js";
export { implementCluster } from "./agents/implement.js";
export { mergeIssueBranchesWithAgent } from "./agents/merger.js";
export { runEpicPlanner, runDependencyPlanner } from "./agents/planner.js";
export { reviewIssues } from "./agents/review.js";
export { branchNameForIssue, buildEpicBrief, flattenClusters, type EpicBrief } from "./planning.js";
export { mergeIssueBranches, processPendingMergeGate } from "./merge.js";
export { runEpicLoop, runEpicLoopWithMessage, printEpicLoopComplete } from "./loop.js";
export { runSandcastlePreflight, type SandcastlePreflightResult } from "./preflight.js";
export { isSandcastleIntegrationBranch, releaseSandcastleWorktrees } from "./worktrees.js";
export {
  epicLabelForEpic,
  integrationBranchForEpic,
  parseEpicList,
  validateEpicSequence,
} from "./epics.js";
export {
  bootstrapIntegrationBranchFromEpic,
  bootstrapIntegrationBranchFromMain,
  buildIntegrationBranchSyncSteps,
  ensureMainBranch,
  mergeIntegrationBranchIntoMain,
  pushBranch,
  pushIntegrationBranchIfEnabled,
  syncIntegrationBranchChain,
  type IntegrationBranchSyncStep,
  type SyncIntegrationBranchChainOptions,
  type SyncIntegrationBranchChainResult,
} from "./git-main.js";
export {
  DEFAULT_EPICS_DIR,
  backlogPhaseFromFileName,
  findIssueBacklogFileForEpic,
  isIssueBacklogFile,
  listBacklogPhases,
  listIssueBacklogFiles,
  loadCanonicalEpicSequence,
  loadEpicSequenceForPhase,
  loadIssueBacklog,
  resolveEpicsDir,
  type BacklogDiscoveryOptions,
  type BacklogIssue,
  type EpicMeta,
  type IssueBacklog,
} from "./backlog.js";
export {
  resolveLongRunConfig,
  runLongEpicOrchestration,
  type LongRunOrchestrationResult,
} from "./longrun.js";
export {
  clusterSchema,
  epicPlanSchema,
  issueSchema,
  legacyClusterSchema,
  planSchema,
  type EpicLoopResult,
  type EpicSandcastleConfig,
  type AgentConfigOverrides,
  type AgentHarness,
  type AgentHarnessConfig,
  type AgentModel,
  type AgentRole,
  type IssueCluster,
  type LongRunSandcastleConfig,
  type PlannedIssue,
  type PromptPaths,
  type ResolvedEpicConfig,
} from "./types.js";
