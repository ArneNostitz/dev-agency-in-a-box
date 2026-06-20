/**
 * Structured memory — a SQLite ledger of what the agency has done. Uses Node's built-in
 * node:sqlite (no native build, works in the container). It records issue lifecycle, every
 * agent run (role/model/turns) for audit + cost, and the plans produced. This is the
 * "what's the exact state / what did we do" layer; semantic (vector) recall comes next.
 *
 * All writes are best-effort: a memory failure must never break the pipeline.
 */
import { encryptSecret, tryDecrypt } from "./crypto.js";
import { parseLegacyStatus, stateColumnFor, STATUS_NOT_PLANNED, type IssueStatus, type BlockedReason } from "./state.js";
import { getDb, now } from "./db/connection.js";
import { getSetting, setSetting, setSecretSetting, getSecretSetting } from "./db/settings.js";

// Re-export the connection-layer symbols the rest of the app imports from store.ts (back-compat).
export { getDb, now, migrateIssueStates } from "./db/connection.js";
export { getSetting, setSetting, setSecretSetting, getSecretSetting } from "./db/settings.js";
export { addEpicChild, updateEpicChild, listEpicChildren, listEpicParents, epicsByParent, getEpicMeta, setEpicMeta } from "./db/epic_tables.js";
export type { EpicChild } from "./db/epic_tables.js";
export { getThreadCursor, setThreadCursor } from "./db/thread_cursor.js";
export { setSession, getSession } from "./db/agent_sessions.js";
export { getAutofixCount, incAutofix, resetAutofix } from "./db/autofix.js";
export { recentRuns } from "./db/runs.js";
export { upsertWorkflow, getWorkflow, listWorkflows, getWorkflowByTrigger, deleteWorkflow, seedWorkflows } from "./db/workflows.js";
export type { Workflow, WorkflowStep, WorkflowGate } from "./db/workflows.js";
export type { RunRow } from "./db/runs.js";
export { upsertLocalIssue, getLocalIssue, listLocalOpenIssues, nextLocalIssueNumber, addLocalComment, getLocalComments, recordOutgoingComment, setCommentGhId, foldInGitHubComment, updateCommentBody, getConversation, conversationCount } from "./db/local.js";
export type { LocalIssue, LocalComment, ConversationComment } from "./db/local.js";
export { getAutoRaw, setAuto, autoEnabled, autoAttempts, bumpAutoAttempts, resetAutoAttempts } from "./db/auto.js";
export type { AutoKind, AutoValue } from "./db/auto.js";
export { upsertSkill, getSkill, listSkills, deleteSkill, skillsPrompt, upsertHook, listHooks, deleteHook } from "./db/skills_hooks.js";
export type { Skill, Hook } from "./db/skills_hooks.js";
export {
  getModelsPresets, getProviders, setProviders, getRoleModels, setRoleModels,
  getGlobalModel, setGlobalModel, setSessionFallback, clearSessionFallback, getSessionFallback,
  getFallbackChain, setFallbackChain, getAutoSwitchOnLimit,
  setIssueModelOverride, getIssueModelOverride, clearIssueModelOverride,
} from "./db/providers.js";
export type { Provider } from "./db/providers.js";
export { upsertAgentDef, getAgentDef, listAgentDefs, deleteAgentDef, chatAgentForText, seedChatAgents } from "./db/agent_def.js";
export type { AgentDef } from "./db/agent_def.js";
export { searchMemory } from "./db/memory.js";
export type { MemoryHit } from "./db/memory.js";
export { getAgentOverride, setAgentOverride, listAgentRevisions, getAgentRevision, deleteAgentOverride, listAgentOverridePaths } from "./db/agent_overrides.js";
export type { AgentRevision } from "./db/agent_overrides.js";
export { addWatchedRepo, removeWatchedRepo, listWatchedRepos } from "./db/watched.js";
// Re-export the users aggregate (Candidate 3, #70).
export {
  countUsers, getUserByName, getUserByNameOrEmail, createPasswordReset, consumePasswordReset,
  getUserById, listUsers, createUser, setUserPassword, authenticate, createSession, getSessionUser,
  revokeSession, createInvite, getInvite, acceptInvite, listInvites,
  setUserSecret, getUserSecret, getUserSecretStatus, listUserSecretKeys,
} from "./db/users.js";
export type { User, UserRow } from "./db/users.js";
// Re-export the reviews aggregate (Candidate 3, #70).
export { recordReview, getReview, clearReview, listReviews } from "./db/reviews.js";
export type { ReviewVerdict } from "./db/reviews.js";
export { recordConflict, getConflict, clearConflict, listConflicts } from "./db/conflicts.js";
export { setRateLimited, clearRateLimited, listRateLimited, dueRateLimited } from "./db/ratelimit.js";
export {
  recordRun, issueSpend, recordTokens, tokensByRoleSince, tokensByDaySince,
  topIssuesByTokensSince, tokensByIssueAll, tokensSince, tokensByModelSince, spendSince,
} from "./db/tokens.js";
export { recordPlan, lastPlan } from "./db/plans.js";
export { recordRunStep, toolStatsSince, recordIncident, recentFailuresSince, runStepCountSince } from "./db/telemetry.js";
export type { ToolStat, FailureStat } from "./db/telemetry.js";
export {
  recordIssueFiles, filesFor, recordIssueState, recordIssueStatus, getIssueStatus,
  recordPr, getIssueRow, recentIssues, archiveIssue, getIssueRole,
} from "./db/issues.js";
export type { IssueRow } from "./db/issues.js";
export { recordLesson, recentLessons, unprocessedLessons, markLessonsProcessed } from "./db/lessons.js";
export type { LessonRow } from "./db/lessons.js";
export { recordActivity, recentActivity, issueActivity } from "./db/activity.js";
export type { ActivityRow } from "./db/activity.js";
