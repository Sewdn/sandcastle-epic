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
  discardHostCheckoutBlockers,
  discardHostMergeBlockers,
  ensureIntegrationBranch,
  ensureIssueBranches,
  featureBranchForIssue,
  integrationMentionsIssue,
  isFastForwardMerge,
  issuesWithCommits,
  listAllLocalPendingFeatureBranches,
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
export { runSupervisor } from "./agents/supervisor.js";
export { runEpicPlanner, runDependencyPlanner } from "./agents/planner.js";
export { reviewIssues } from "./agents/review.js";
export {
  affectedPackageNames,
  changedPathsBetweenRefs,
  formatAffectedValidationScope,
} from "./affected.js";
export {
  hostDoraIndexCommand,
  patchDoraConfigForHostIndex,
  refreshDoraIndex,
  refreshDoraIndexForRepo,
  resolveIndexCheckoutPath,
} from "./dora.js";
export { maybeIntervene, recentSandcastleLogPaths, type InterventionBrief } from "./intervention.js";
export {
  DEFAULT_PARALLEL_CLUSTER_LIMIT,
  mapWithConcurrency,
  resolveParallelClusterConfig,
  type ParallelClusterConfig,
} from "./parallel.js";
export { SHARED_SANDBOX_MOUNTS } from "./sandbox.js";
export {
  branchNameForIssue,
  buildEpicBrief,
  flattenClusters,
  listEpicPendingMergeIssues,
  pendingMergeIssuesFromBrief,
  type EpicBrief,
} from "./planning.js";
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
  filterEpicsFromProjectMap,
  loadProjectMapFromGithub,
  logProjectMapSummary,
  type LongRunOrchestrationResult,
} from "./longrun.js";
export {
  buildProjectMap,
  type EpicProjectEntry,
  type EpicProjectStatus,
  type ProjectMap,
} from "./project-map.js";
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
