import { readFile } from "node:fs/promises";

import { ConfigError } from "../errors.ts";
import { executeGraphql } from "../graphql/client.ts";
import {
  COMMENT_CREATE,
  ISSUE_ARCHIVE,
  ISSUE_BY_ID_QUERY,
  ISSUE_BY_IDENTIFIER_QUERY,
  ISSUE_COMMENTS_QUERY,
  ISSUE_CREATE,
  ISSUE_LABELS_QUERY,
  ISSUE_INCOMING_RELATIONS_QUERY,
  ISSUE_OUTGOING_RELATIONS_QUERY,
  ISSUE_RELATION_CREATE,
  ISSUE_RELATION_DELETE,
  ISSUE_UNARCHIVE,
  ISSUE_UPDATE,
  ISSUES_QUERY,
  SEARCH_ISSUES_QUERY,
  WORKFLOW_STATES_QUERY,
  type CommentCreateResult,
  type Cycle,
  type IssueArchiveResult,
  type IssueByIdResult,
  type IssueComment,
  type IssueCommentsResult,
  type IssueCreateResult,
  type IssueIncomingRelationsResult,
  type IssueLabel,
  type IssueLabelsResult,
  type IssueOutgoingRelationsResult,
  type IssueRelation,
  type IssueRelationCreateResult,
  type IssueRelationDeleteResult,
  type IssueSummary,
  type IssueUnarchiveResult,
  type IssueUpdateResult,
  type IssuesResult,
  type Project,
  type SearchIssuesResult,
  type Team,
  type User,
  type WorkflowState,
  type WorkflowStatesResult,
} from "../graphql/documents.ts";
import { fetchAllNodes, fetchNodes } from "../graphql/paginate.ts";
import { resolveCycle } from "./cycles.ts";
import { resolveProject } from "./projects.ts";
import { credentialOptions, singleMatch } from "./shared.ts";
import { listTeams } from "./teams.ts";
import { resolveUser } from "./users.ts";

export interface IssueCommandOptions {
  debug?: boolean;
  /** When true, identifier lookups include archived issues (needed for unarchive). */
  includeArchived?: boolean;
}

interface TeamRef {
  id: string;
  key: string;
  name: string;
}

export interface IssueMutationData {
  applied: boolean;
  issue: IssueSummary;
  input: Record<string, unknown>;
  plannedChanges: Record<string, { from: unknown; to: unknown }>;
  result?: IssueSummary;
}

export interface IssueCreateData {
  applied: boolean;
  input: Record<string, unknown>;
  result?: IssueSummary;
}

export interface IssueCommentData {
  applied: boolean;
  issue: IssueSummary;
  input: Record<string, unknown>;
  comment?: CommentCreateResult["commentCreate"]["comment"];
}

export interface IssueArchiveData {
  applied: boolean;
  issue: IssueSummary;
  trash: boolean;
  result?: { id: string; identifier: string; title: string; url: string } | null;
}

export interface IssueUnarchiveData {
  applied: boolean;
  issue: IssueSummary;
  result?: { id: string; identifier: string; title: string; url: string } | null;
}

export interface IssueUpdateOptions extends IssueCommandOptions {
  title?: string;
  description?: string;
  descriptionFile?: string;
  state?: string;
  assignee?: string;
  priority?: string;
  parent?: string;
  project?: string;
  cycle?: string;
  dueDate?: string;
  estimate?: string;
  team?: string;
  label?: string[];
  addLabel?: string[];
  removeLabel?: string[];
  apply?: boolean;
}

export interface IssueCreateOptions extends IssueCommandOptions {
  team: string;
  title: string;
  description?: string;
  descriptionFile?: string;
  state?: string;
  assignee?: string;
  priority?: string;
  project?: string;
  cycle?: string;
  dueDate?: string;
  estimate?: string;
  parent?: string;
  label?: string[];
  apply?: boolean;
}

export interface IssueSearchOptions extends IssueCommandOptions {
  team?: string;
  state?: string;
  assignee?: string;
  query?: string;
  includeArchived?: boolean;
  includeComments?: boolean;
  limit?: number;
}

export const DEFAULT_ISSUE_SEARCH_LIMIT = 50;
export const ISSUE_RELATION_TYPES = ["blocks", "duplicate", "related", "similar"] as const;
export type IssueRelationType = (typeof ISSUE_RELATION_TYPES)[number];

const ISSUE_IDENTIFIER = /^([A-Za-z][A-Za-z0-9]*)-(\d+)$/;
const PRIORITY_BY_LABEL: Record<string, number> = {
  none: 0,
  urgent: 1,
  high: 2,
  normal: 3,
  medium: 3,
  low: 4,
};
const DUE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function readOptionalText(
  inline: string | undefined,
  file: string | undefined,
  field: string,
): Promise<string | undefined> {
  if (inline !== undefined && file !== undefined) {
    throw new ConfigError(`Use either --${field} or --${field}-file, not both.`);
  }
  if (file === undefined) return inline;
  return readFile(file, "utf8").catch(() => {
    throw new ConfigError(`Could not read ${field} file: ${file}`);
  });
}

function parsePriority(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (/^[0-4]$/.test(normalized)) return Number(normalized);
  const priority = PRIORITY_BY_LABEL[normalized];
  if (priority === undefined) {
    throw new ConfigError("Priority must be one of none, urgent, high, normal, low, or 0-4.");
  }
  return priority;
}

function parseDueDate(value: string | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (["none", "null", "clear"].includes(normalized)) return null;
  if (!DUE_DATE_RE.test(value.trim())) {
    throw new ConfigError("Due date must be YYYY-MM-DD, or none to clear.");
  }
  return value.trim();
}

function parseEstimate(value: string | undefined): number | null | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (["none", "null", "clear"].includes(normalized)) return null;
  if (!/^\d+$/.test(value.trim())) {
    throw new ConfigError("Estimate must be a non-negative integer, or none to clear.");
  }
  const estimate = Number(value);
  if (!Number.isInteger(estimate) || estimate < 0) {
    throw new ConfigError("Estimate must be a non-negative integer, or none to clear.");
  }
  return estimate;
}

/** Shared by issue/project/cycle list commands. */
export function parsePositiveLimit(
  value: number | undefined,
  fallback?: number,
): number | undefined {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1) {
    throw new ConfigError("--limit must be a positive integer.");
  }
  return value;
}

function parseLimit(value: number | undefined): number {
  return parsePositiveLimit(value, DEFAULT_ISSUE_SEARCH_LIMIT) ?? DEFAULT_ISSUE_SEARCH_LIMIT;
}

export async function resolveTeam(teamRef: string, opts: IssueCommandOptions): Promise<Team> {
  const teams = await listTeams({ includeArchived: false, debug: opts.debug });
  const normalized = teamRef.toLowerCase();
  const matches = teams.filter(
    (team) =>
      team.id === teamRef ||
      team.key.toLowerCase() === normalized ||
      team.name.toLowerCase() === normalized,
  );
  return singleMatch(
    matches,
    `No team found for: ${teamRef}`,
    `Team reference is ambiguous: ${teamRef}`,
  );
}

async function resolveAssignee(
  assignee: string | undefined,
  opts: IssueCommandOptions,
): Promise<User | null | undefined> {
  if (assignee === undefined) return undefined;
  if (["none", "null", "unassigned"].includes(assignee.trim().toLowerCase())) return null;
  return resolveUser(assignee, {
    debug: opts.debug,
    emptyMessage: `No active user found for assignee: ${assignee}`,
    ambiguousMessage: `Assignee reference is ambiguous: ${assignee}`,
  });
}

export async function listStates(options: {
  team?: string;
  debug?: boolean;
}): Promise<WorkflowState[]> {
  const filter = options.team
    ? { team: { key: { eq: (await resolveTeam(options.team, options)).key } } }
    : undefined;
  return fetchAllNodes<WorkflowState, WorkflowStatesResult>(
    WORKFLOW_STATES_QUERY,
    (data) => data.workflowStates,
    await credentialOptions(options.debug),
    { filter },
  );
}

async function resolveState(
  state: string | undefined,
  team: TeamRef,
  opts: IssueCommandOptions,
): Promise<WorkflowState | undefined> {
  if (state === undefined) return undefined;
  const states = await listStates({ team: team.key, debug: opts.debug });
  const normalized = state.toLowerCase();
  const matches = states.filter(
    (candidate) =>
      candidate.id === state ||
      candidate.name.toLowerCase() === normalized ||
      candidate.type.toLowerCase() === normalized,
  );
  return singleMatch(
    matches,
    `No state found for ${team.key}: ${state}`,
    `State reference is ambiguous for ${team.key}: ${state}`,
  );
}

export async function listLabels(options: {
  team?: string;
  includeWorkspace?: boolean;
  debug?: boolean;
}): Promise<IssueLabel[]> {
  let filter: Record<string, unknown> | undefined;
  if (options.team) {
    const team = await resolveTeam(options.team, options);
    filter = options.includeWorkspace
      ? { or: [{ team: { key: { eq: team.key } } }, { team: { null: true } }] }
      : { team: { key: { eq: team.key } } };
  }
  return fetchAllNodes<IssueLabel, IssueLabelsResult>(
    ISSUE_LABELS_QUERY,
    (data) => data.issueLabels,
    await credentialOptions(options.debug),
    { filter },
  );
}

async function resolveLabels(
  labels: string[] | undefined,
  team: TeamRef,
  opts: IssueCommandOptions,
): Promise<IssueLabel[] | undefined> {
  if (!labels?.length) return undefined;
  const available = await listLabels({ team: team.key, includeWorkspace: true, debug: opts.debug });
  return labels.map((label) => {
    const normalized = label.toLowerCase();
    const matches = available.filter(
      (candidate) => candidate.id === label || candidate.name.toLowerCase() === normalized,
    );
    return singleMatch(
      matches,
      `No label found for ${team.key}: ${label}`,
      `Label reference is ambiguous for ${team.key}: ${label}`,
    );
  });
}

async function resolveCycleForTeam(
  cycleRef: string | undefined,
  team: TeamRef,
  opts: IssueCommandOptions,
): Promise<Cycle | null | undefined> {
  if (cycleRef === undefined) return undefined;
  if (["none", "null", "clear"].includes(cycleRef.trim().toLowerCase())) return null;
  return resolveCycle(cycleRef, team, opts);
}

export async function getIssue(ref: string, opts: IssueCommandOptions = {}): Promise<IssueSummary> {
  const identifier = ISSUE_IDENTIFIER.exec(ref);
  if (identifier) {
    const [, teamKey, issueNumber] = identifier;
    if (teamKey === undefined || issueNumber === undefined) {
      throw new ConfigError(`Invalid issue identifier: ${ref}`);
    }
    const data = await executeGraphql<IssuesResult>(
      ISSUE_BY_IDENTIFIER_QUERY,
      {
        teamKey: teamKey.toUpperCase(),
        number: Number(issueNumber),
        includeArchived: opts.includeArchived ?? false,
      },
      await credentialOptions(opts.debug),
    );
    return singleMatch(
      data.issues.nodes,
      `No issue found for: ${ref}`,
      `Issue reference is ambiguous: ${ref}`,
    );
  }

  const data = await executeGraphql<IssueByIdResult>(
    ISSUE_BY_ID_QUERY,
    { id: ref },
    await credentialOptions(opts.debug),
  );
  if (!data.issue) throw new ConfigError(`No issue found for: ${ref}`);
  return data.issue;
}

async function resolveParentForCreate(
  parentRef: string | undefined,
  opts: IssueCommandOptions,
): Promise<IssueSummary | undefined> {
  if (parentRef === undefined) return undefined;
  if (["none", "null"].includes(parentRef.trim().toLowerCase())) {
    throw new ConfigError("--parent none is only valid for issue update.");
  }
  return getIssue(parentRef, opts);
}

async function resolveParentForUpdate(
  parentRef: string | undefined,
  opts: IssueCommandOptions,
): Promise<IssueSummary | null | undefined> {
  if (parentRef === undefined) return undefined;
  if (["none", "null"].includes(parentRef.trim().toLowerCase())) return null;
  return getIssue(parentRef, opts);
}

async function resolveProjectForUpdate(
  projectRef: string | undefined,
  team: TeamRef,
  opts: IssueCommandOptions,
): Promise<Project | null | undefined> {
  if (projectRef === undefined) return undefined;
  if (["none", "null", "clear"].includes(projectRef.trim().toLowerCase())) return null;
  return resolveProject(projectRef, team, opts);
}

export async function searchIssues(options: IssueSearchOptions): Promise<IssueSummary[]> {
  const limit = parseLimit(options.limit);
  const filter: Record<string, unknown> = {};
  let team: Team | undefined;
  if (options.team) {
    team = await resolveTeam(options.team, options);
    filter.team = { key: { eq: team.key } };
  }
  if (options.state) {
    if (!team) throw new ConfigError("--state requires --team so the state name can be resolved.");
    const state = await resolveState(options.state, team, options);
    if (state) filter.state = { id: { eq: state.id } };
  }
  if (options.assignee) {
    const assignee = await resolveAssignee(options.assignee, options);
    if (assignee === null) {
      filter.assignee = { null: true };
    } else if (assignee) {
      filter.assignee = { id: { eq: assignee.id } };
    }
  }

  const creds = await credentialOptions(options.debug);
  const variables: Record<string, unknown> = {
    filter: Object.keys(filter).length ? filter : undefined,
    includeArchived: options.includeArchived ?? false,
  };

  if (options.query?.trim()) {
    return fetchNodes<IssueSummary, SearchIssuesResult>(
      SEARCH_ISSUES_QUERY,
      (data) => data.searchIssues,
      creds,
      {
        ...variables,
        term: options.query.trim(),
        teamId: team?.id,
        includeComments: options.includeComments ?? false,
      },
      { limit },
    );
  }

  return fetchNodes<IssueSummary, IssuesResult>(
    ISSUES_QUERY,
    (data) => data.issues,
    creds,
    variables,
    { limit },
  );
}

function plannedChange(from: unknown, to: unknown): { from: unknown; to: unknown } | undefined {
  return Object.is(from, to) ? undefined : { from, to };
}

type PlannedChanges = Record<string, { from: unknown; to: unknown }>;

function applyScalarChange(
  input: Record<string, unknown>,
  plannedChanges: PlannedChanges,
  field: string,
  from: unknown,
  to: unknown,
  inputField: string = field,
): void {
  if (to === undefined) return;
  const change = plannedChange(from, to);
  if (!change) return;
  plannedChanges[field] = change;
  input[inputField] = to;
}

function applyRefChange(
  input: Record<string, unknown>,
  plannedChanges: PlannedChanges,
  field: string,
  inputField: string,
  fromId: string | null,
  toId: string | null,
  fromLabel: unknown,
  toLabel: unknown,
): void {
  const change = plannedChange(fromId, toId);
  if (!change) return;
  plannedChanges[field] = { from: fromLabel, to: toLabel };
  input[inputField] = toId;
}

function applyLabelChanges(
  input: Record<string, unknown>,
  plannedChanges: PlannedChanges,
  issue: IssueSummary,
  labels: IssueLabel[] | undefined,
  addLabels: IssueLabel[] | undefined,
  removeLabels: IssueLabel[] | undefined,
): void {
  if (labels) {
    const nextLabelIds = labels.map((label) => label.id).sort();
    const currentLabelIds = issue.labels.nodes.map((label) => label.id).sort();
    const change = plannedChange(currentLabelIds.join(","), nextLabelIds.join(","));
    if (change) {
      plannedChanges.labels = {
        from: issue.labels.nodes.map((label) => label.name),
        to: labels.map((label) => label.name),
      };
      input.labelIds = nextLabelIds;
    }
  }
  if (addLabels?.length) {
    plannedChanges.addedLabels = { from: [], to: addLabels.map((label) => label.name) };
    input.addedLabelIds = addLabels.map((label) => label.id);
  }
  if (removeLabels?.length) {
    plannedChanges.removedLabels = { from: removeLabels.map((label) => label.name), to: [] };
    input.removedLabelIds = removeLabels.map((label) => label.id);
  }
}

async function resolveUpdateFields(issue: IssueSummary, options: IssueUpdateOptions) {
  const hasReplaceLabels = Boolean(options.label?.length);
  const hasAddLabels = Boolean(options.addLabel?.length);
  const hasRemoveLabels = Boolean(options.removeLabel?.length);
  if (hasReplaceLabels && (hasAddLabels || hasRemoveLabels)) {
    throw new ConfigError("Use either --label (replace) or --add-label/--remove-label, not both.");
  }

  const nextTeam = options.team ? await resolveTeam(options.team, options) : issue.team;
  return {
    description: await readOptionalText(
      options.description,
      options.descriptionFile,
      "description",
    ),
    nextTeam,
    state: await resolveState(options.state, nextTeam, options),
    assignee: await resolveAssignee(options.assignee, options),
    labels: await resolveLabels(options.label, nextTeam, options),
    addLabels: await resolveLabels(options.addLabel, nextTeam, options),
    removeLabels: await resolveLabels(options.removeLabel, nextTeam, options),
    priority: parsePriority(options.priority),
    parent: await resolveParentForUpdate(options.parent, options),
    project: await resolveProjectForUpdate(options.project, nextTeam, options),
    cycle: await resolveCycleForTeam(options.cycle, nextTeam, options),
    dueDate: parseDueDate(options.dueDate),
    estimate: parseEstimate(options.estimate),
  };
}

function cycleLabel(
  cycle: { name: string | null; number: number } | null | undefined,
): string | null {
  if (!cycle) return null;
  return cycle.name ?? String(cycle.number);
}

function applyTeamAndStateChanges(
  input: Record<string, unknown>,
  plannedChanges: PlannedChanges,
  issue: IssueSummary,
  options: IssueUpdateOptions,
  nextTeam: TeamRef,
  state: WorkflowState | undefined,
): void {
  if (options.team && nextTeam.id !== issue.team.id) {
    plannedChanges.team = { from: issue.team.key, to: nextTeam.key };
    input.teamId = nextTeam.id;
  }
  if (state && state.id !== issue.state.id) {
    plannedChanges.state = { from: issue.state.name, to: state.name };
    input.stateId = state.id;
  }
}

function applyOptionalRefs(
  input: Record<string, unknown>,
  plannedChanges: PlannedChanges,
  issue: IssueSummary,
  parent: IssueSummary | null | undefined,
  project: Project | null | undefined,
  cycle: Cycle | null | undefined,
): void {
  if (parent !== undefined) {
    applyRefChange(
      input,
      plannedChanges,
      "parent",
      "parentId",
      issue.parent?.id ?? null,
      parent?.id ?? null,
      issue.parent?.identifier ?? null,
      parent?.identifier ?? null,
    );
  }
  if (project !== undefined) {
    applyRefChange(
      input,
      plannedChanges,
      "project",
      "projectId",
      issue.project?.id ?? null,
      project?.id ?? null,
      issue.project?.name ?? null,
      project?.name ?? null,
    );
  }
  if (cycle !== undefined) {
    applyRefChange(
      input,
      plannedChanges,
      "cycle",
      "cycleId",
      issue.cycle?.id ?? null,
      cycle?.id ?? null,
      cycleLabel(issue.cycle),
      cycleLabel(cycle),
    );
  }
}

function buildIssueUpdatePlan(
  issue: IssueSummary,
  options: IssueUpdateOptions,
  resolved: Awaited<ReturnType<typeof resolveUpdateFields>>,
): { input: Record<string, unknown>; plannedChanges: PlannedChanges } {
  const input: Record<string, unknown> = {};
  const plannedChanges: PlannedChanges = {};
  const {
    nextTeam,
    state,
    assignee,
    labels,
    addLabels,
    removeLabels,
    priority,
    parent,
    project,
    cycle,
    dueDate,
    estimate,
    description,
  } = resolved;

  applyScalarChange(input, plannedChanges, "title", issue.title, options.title);
  applyScalarChange(input, plannedChanges, "description", issue.description, description);
  applyTeamAndStateChanges(input, plannedChanges, issue, options, nextTeam, state);
  applyScalarChange(
    input,
    plannedChanges,
    "assignee",
    issue.assignee?.email ?? null,
    assignee === undefined ? undefined : (assignee?.email ?? null),
    "assigneeId",
  );
  if (assignee !== undefined) input.assigneeId = assignee?.id ?? null;
  applyScalarChange(input, plannedChanges, "priority", issue.priority, priority);
  applyOptionalRefs(input, plannedChanges, issue, parent, project, cycle);
  applyScalarChange(input, plannedChanges, "dueDate", issue.dueDate ?? null, dueDate);
  applyScalarChange(input, plannedChanges, "estimate", issue.estimate ?? null, estimate);
  applyLabelChanges(input, plannedChanges, issue, labels, addLabels, removeLabels);

  return { input, plannedChanges };
}

export async function updateIssue(
  ref: string,
  options: IssueUpdateOptions,
): Promise<IssueMutationData> {
  const issue = await getIssue(ref, options);
  const resolved = await resolveUpdateFields(issue, options);
  const { input, plannedChanges } = buildIssueUpdatePlan(issue, options, resolved);

  if (Object.keys(input).length === 0 || !options.apply) {
    return { applied: false, issue, input, plannedChanges };
  }

  const result = await executeGraphql<IssueUpdateResult>(
    ISSUE_UPDATE,
    { id: issue.id, input },
    await credentialOptions(options.debug),
  );
  if (!result.issueUpdate.success)
    throw new ConfigError("Linear reported the issue was not updated.");
  return { applied: true, issue, input, plannedChanges, result: result.issueUpdate.issue };
}

export async function createIssue(options: IssueCreateOptions): Promise<IssueCreateData> {
  const team = await resolveTeam(options.team, options);
  const description = await readOptionalText(
    options.description,
    options.descriptionFile,
    "description",
  );
  const state = await resolveState(options.state, team, options);
  const assignee = await resolveAssignee(options.assignee, options);
  const labels = await resolveLabels(options.label, team, options);
  const project = options.project
    ? await resolveProject(options.project, team, options)
    : undefined;
  const cycle = await resolveCycleForTeam(options.cycle, team, options);
  const priority = parsePriority(options.priority);
  const dueDate = parseDueDate(options.dueDate);
  const estimate = parseEstimate(options.estimate);
  const parent = await resolveParentForCreate(options.parent, options);

  const input: Record<string, unknown> = { teamId: team.id, title: options.title };
  if (description !== undefined) input.description = description;
  if (state) input.stateId = state.id;
  if (assignee !== undefined) input.assigneeId = assignee?.id ?? null;
  if (labels) input.labelIds = labels.map((label) => label.id);
  if (project) input.projectId = project.id;
  if (cycle) input.cycleId = cycle.id;
  if (parent) input.parentId = parent.id;
  if (priority !== undefined) input.priority = priority;
  if (dueDate !== undefined && dueDate !== null) input.dueDate = dueDate;
  if (estimate !== undefined && estimate !== null) input.estimate = estimate;

  if (!options.apply) return { applied: false, input };

  const result = await executeGraphql<IssueCreateResult>(
    ISSUE_CREATE,
    { input },
    await credentialOptions(options.debug),
  );
  if (!result.issueCreate.success)
    throw new ConfigError("Linear reported the issue was not created.");
  return { applied: true, input, result: result.issueCreate.issue };
}

export async function commentOnIssue(
  ref: string,
  options: IssueCommandOptions & { body?: string; bodyFile?: string; apply?: boolean },
): Promise<IssueCommentData> {
  const issue = await getIssue(ref, options);
  const body = await readOptionalText(options.body, options.bodyFile, "body");
  if (!body?.trim()) throw new ConfigError("Comment body is required. Use --body or --body-file.");
  const input = { issueId: issue.id, body };

  if (!options.apply) return { applied: false, issue, input };

  const result = await executeGraphql<CommentCreateResult>(
    COMMENT_CREATE,
    { input },
    await credentialOptions(options.debug),
  );
  if (!result.commentCreate.success)
    throw new ConfigError("Linear reported the comment was not created.");
  return { applied: true, issue, input, comment: result.commentCreate.comment };
}

export async function listIssueComments(
  ref: string,
  options: IssueCommandOptions & { limit?: number } = {},
): Promise<{ issue: IssueSummary; comments: IssueComment[] }> {
  const issue = await getIssue(ref, options);
  const limit = parseLimit(options.limit);
  const comments = await fetchNodes<IssueComment, IssueCommentsResult>(
    ISSUE_COMMENTS_QUERY,
    (data) => {
      if (!data.issue) throw new ConfigError(`No issue found for: ${ref}`);
      return data.issue.comments;
    },
    await credentialOptions(options.debug),
    { id: issue.id },
    { limit },
  );
  return { issue, comments };
}

export async function archiveIssue(
  ref: string,
  options: IssueCommandOptions & { apply?: boolean; trash?: boolean } = {},
): Promise<IssueArchiveData> {
  const issue = await getIssue(ref, options);
  const trash = options.trash ?? false;
  if (!options.apply) return { applied: false, issue, trash };

  const result = await executeGraphql<IssueArchiveResult>(
    ISSUE_ARCHIVE,
    { id: issue.id, trash },
    await credentialOptions(options.debug),
  );
  if (!result.issueArchive.success)
    throw new ConfigError("Linear reported the issue was not archived.");
  return { applied: true, issue, trash, result: result.issueArchive.entity };
}

export async function unarchiveIssue(
  ref: string,
  options: IssueCommandOptions & { apply?: boolean } = {},
): Promise<IssueUnarchiveData> {
  // Identifier lookups omit archived issues by default; unarchive must see them.
  const issue = await getIssue(ref, { ...options, includeArchived: true });
  if (!options.apply) return { applied: false, issue };

  const result = await executeGraphql<IssueUnarchiveResult>(
    ISSUE_UNARCHIVE,
    { id: issue.id },
    await credentialOptions(options.debug),
  );
  if (!result.issueUnarchive.success)
    throw new ConfigError("Linear reported the issue was not unarchived.");
  return { applied: true, issue, result: result.issueUnarchive.entity };
}

export async function listIssueRelations(
  ref: string,
  options: IssueCommandOptions = {},
): Promise<{
  issue: { id: string; identifier: string };
  relations: IssueRelation[];
  inverseRelations: IssueRelation[];
}> {
  const issue = await getIssue(ref, options);
  const creds = await credentialOptions(options.debug);
  const relations = await fetchAllNodes<IssueRelation, IssueOutgoingRelationsResult>(
    ISSUE_OUTGOING_RELATIONS_QUERY,
    (data) => {
      if (!data.issue) throw new ConfigError(`No issue found for: ${ref}`);
      return data.issue.relations;
    },
    creds,
    { id: issue.id },
  );
  const inverseRelations = await fetchAllNodes<IssueRelation, IssueIncomingRelationsResult>(
    ISSUE_INCOMING_RELATIONS_QUERY,
    (data) => {
      if (!data.issue) throw new ConfigError(`No issue found for: ${ref}`);
      return data.issue.inverseRelations;
    },
    creds,
    { id: issue.id },
  );
  return {
    issue: { id: issue.id, identifier: issue.identifier },
    relations,
    inverseRelations,
  };
}

export async function createIssueRelation(
  ref: string,
  options: IssueCommandOptions & {
    type: string;
    related: string;
    apply?: boolean;
  },
): Promise<{
  applied: boolean;
  input: Record<string, unknown>;
  issue: IssueSummary;
  related: IssueSummary;
  relation?: IssueRelation;
}> {
  const type = options.type.trim().toLowerCase();
  if (!ISSUE_RELATION_TYPES.includes(type as IssueRelationType)) {
    throw new ConfigError(
      `Relation type must be one of ${ISSUE_RELATION_TYPES.join(", ")}. Got: ${options.type}`,
    );
  }
  const issue = await getIssue(ref, options);
  const related = await getIssue(options.related, options);
  const input = { issueId: issue.id, relatedIssueId: related.id, type };
  if (!options.apply) return { applied: false, input, issue, related };

  const result = await executeGraphql<IssueRelationCreateResult>(
    ISSUE_RELATION_CREATE,
    { input },
    await credentialOptions(options.debug),
  );
  if (!result.issueRelationCreate.success)
    throw new ConfigError("Linear reported the issue relation was not created.");
  return {
    applied: true,
    input,
    issue,
    related,
    relation: result.issueRelationCreate.issueRelation,
  };
}

export async function deleteIssueRelation(
  id: string,
  options: IssueCommandOptions & { apply?: boolean } = {},
): Promise<{ applied: boolean; id: string }> {
  if (!id.trim()) throw new ConfigError("A relation ID is required.");
  if (!options.apply) return { applied: false, id };
  const result = await executeGraphql<IssueRelationDeleteResult>(
    ISSUE_RELATION_DELETE,
    { id },
    await credentialOptions(options.debug),
  );
  if (!result.issueRelationDelete.success)
    throw new ConfigError("Linear reported the issue relation was not deleted.");
  return { applied: true, id };
}

export function formatIssue(issue: IssueSummary): string {
  const labels = issue.labels.nodes.map((label) => label.name).join(", ") || "(none)";
  const parent = issue.parent ? `${issue.parent.identifier} ${issue.parent.title}` : "(none)";
  const children = issue.children.nodes.map((child) => child.identifier).join(", ") || "(none)";
  const cycle = issue.cycle
    ? `${issue.cycle.name ?? `Cycle ${issue.cycle.number}`} (#${issue.cycle.number})`
    : "(none)";
  return [
    `${issue.identifier} ${issue.title}`,
    `State: ${issue.state.name} (${issue.state.type})`,
    `Team: ${issue.team.key} ${issue.team.name}`,
    `Assignee: ${issue.assignee ? `${issue.assignee.name} <${issue.assignee.email}>` : "(unassigned)"}`,
    `Priority: ${issue.priorityLabel}`,
    `Project: ${issue.project?.name ?? "(none)"}`,
    `Cycle: ${cycle}`,
    `Due: ${issue.dueDate ?? "(none)"}`,
    `Estimate: ${issue.estimate ?? "(none)"}`,
    `Parent: ${parent}`,
    `Children: ${children}`,
    `Labels: ${labels}`,
    `URL: ${issue.url}`,
    issue.description ? `Description:\n${issue.description}` : "Description: (none)",
  ].join("\n");
}

export function formatIssuesList(issues: IssueSummary[]): {
  rows: Record<string, unknown>[];
  columns: string[];
} {
  return {
    rows: issues.map((issue) => ({
      id: issue.identifier,
      title: issue.title,
      state: issue.state.name,
      assignee: issue.assignee?.email ?? "",
      priority: issue.priorityLabel,
      project: issue.project?.name ?? "",
    })),
    columns: ["id", "title", "state", "assignee", "priority", "project"],
  };
}

export function formatStatesList(states: WorkflowState[]): {
  rows: Record<string, unknown>[];
  columns: string[];
} {
  return {
    rows: states.map((state) => ({
      team: state.team.key,
      name: state.name,
      type: state.type,
      id: state.id,
    })),
    columns: ["team", "name", "type", "id"],
  };
}

export function formatLabelsList(labels: IssueLabel[]): {
  rows: Record<string, unknown>[];
  columns: string[];
} {
  return {
    rows: labels.map((label) => ({
      team: label.team?.key ?? "(workspace)",
      name: label.name,
      color: label.color,
      id: label.id,
    })),
    columns: ["team", "name", "color", "id"],
  };
}

export function formatCommentsList(comments: IssueComment[]): {
  rows: Record<string, unknown>[];
  columns: string[];
} {
  return {
    rows: comments.map((comment) => ({
      id: comment.id,
      user: comment.user?.email ?? comment.user?.name ?? "",
      created: comment.createdAt,
      body: (comment.body ?? "").replace(/\s+/g, " ").slice(0, 80),
    })),
    columns: ["id", "user", "created", "body"],
  };
}

export function formatRelationsList(
  relations: IssueRelation[],
  inverseRelations: IssueRelation[],
): {
  rows: Record<string, unknown>[];
  columns: string[];
} {
  const rows = [
    ...relations.map((relation) => ({
      direction: "out",
      type: relation.type,
      from: relation.issue.identifier,
      to: relation.relatedIssue.identifier,
      id: relation.id,
    })),
    ...inverseRelations.map((relation) => ({
      direction: "in",
      type: relation.type,
      from: relation.issue.identifier,
      to: relation.relatedIssue.identifier,
      id: relation.id,
    })),
  ];
  return { rows, columns: ["direction", "type", "from", "to", "id"] };
}
