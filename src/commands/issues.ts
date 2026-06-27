import { readFile } from "node:fs/promises";

import { resolveCredential } from "../config.ts";
import { ConfigError } from "../errors.ts";
import { executeGraphql } from "../graphql/client.ts";
import {
  COMMENT_CREATE,
  ISSUE_BY_ID_QUERY,
  ISSUE_BY_IDENTIFIER_QUERY,
  ISSUE_CREATE,
  ISSUE_LABELS_QUERY,
  ISSUE_UPDATE,
  ISSUES_QUERY,
  PROJECTS_QUERY,
  USERS_QUERY,
  WORKFLOW_STATES_QUERY,
  type CommentCreateResult,
  type IssueByIdResult,
  type IssueCreateResult,
  type IssueLabel,
  type IssueLabelsResult,
  type IssueSummary,
  type IssueUpdateResult,
  type IssuesResult,
  type Project,
  type ProjectsResult,
  type Team,
  type User,
  type UsersResult,
  type WorkflowState,
  type WorkflowStatesResult,
} from "../graphql/documents.ts";
import { fetchAllNodes } from "../graphql/paginate.ts";
import { listTeams } from "./teams.ts";

export interface IssueCommandOptions {
  debug?: boolean;
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

export interface IssueUpdateOptions extends IssueCommandOptions {
  title?: string;
  description?: string;
  descriptionFile?: string;
  state?: string;
  assignee?: string;
  priority?: string;
  parent?: string;
  label?: string[];
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
  parent?: string;
  label?: string[];
  apply?: boolean;
}

export interface IssueSearchOptions extends IssueCommandOptions {
  team?: string;
  state?: string;
  assignee?: string;
  includeArchived?: boolean;
}

const ISSUE_IDENTIFIER = /^([A-Za-z][A-Za-z0-9]*)-(\d+)$/;
const PRIORITY_BY_LABEL: Record<string, number> = {
  none: 0,
  urgent: 1,
  high: 2,
  normal: 3,
  medium: 3,
  low: 4,
};

function singleMatch<T>(matches: T[], emptyMessage: string, ambiguousMessage: string): T {
  if (matches.length === 0) {
    throw new ConfigError(emptyMessage);
  }
  if (matches.length > 1) {
    throw new ConfigError(ambiguousMessage);
  }
  const match = matches[0];
  if (match === undefined) {
    throw new ConfigError(emptyMessage);
  }
  return match;
}

async function credentialOptions(debug?: boolean) {
  return { credential: await resolveCredential(), debug };
}

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

async function resolveTeam(teamRef: string, opts: IssueCommandOptions): Promise<Team> {
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

async function listUsersForResolution(opts: IssueCommandOptions): Promise<User[]> {
  return fetchAllNodes<User, UsersResult>(
    USERS_QUERY,
    (data) => data.users,
    await credentialOptions(opts.debug),
    { includeArchived: false },
  );
}

async function resolveAssignee(
  assignee: string | undefined,
  opts: IssueCommandOptions,
): Promise<User | null | undefined> {
  if (assignee === undefined) return undefined;
  if (["none", "null", "unassigned"].includes(assignee.trim().toLowerCase())) return null;
  const users = await listUsersForResolution(opts);
  if (assignee.trim().toLowerCase() === "me") {
    const current = await executeGraphql<{ viewer: User }>(
      "query ViewerUser { viewer { id name email active admin archivedAt } }",
      {},
      await credentialOptions(opts.debug),
    );
    return current.viewer;
  }
  const normalized = assignee.toLowerCase();
  const matches = users.filter(
    (user) =>
      user.id === assignee ||
      user.email.toLowerCase() === normalized ||
      user.name.toLowerCase() === normalized,
  );
  return singleMatch(
    matches,
    `No active user found for assignee: ${assignee}`,
    `Assignee reference is ambiguous: ${assignee}`,
  );
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

async function resolveProject(
  projectRef: string | undefined,
  team: TeamRef,
  opts: IssueCommandOptions,
): Promise<Project | undefined> {
  if (projectRef === undefined) return undefined;
  const projects = await fetchAllNodes<Project, ProjectsResult>(
    PROJECTS_QUERY,
    (data) => data.projects,
    credentialOptions(opts.debug),
    {
      filter: { accessibleTeams: { some: { id: { eq: team.id } } } },
      includeArchived: false,
    },
  );
  const normalized = projectRef.toLowerCase();
  const matches = projects.filter(
    (project) => project.id === projectRef || project.name.toLowerCase() === normalized,
  );
  return singleMatch(
    matches,
    `No project found for ${team.key}: ${projectRef}`,
    `Project reference is ambiguous for ${team.key}: ${projectRef}`,
  );
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
      { teamKey: teamKey.toUpperCase(), number: Number(issueNumber) },
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

export async function searchIssues(options: IssueSearchOptions): Promise<IssueSummary[]> {
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

  return fetchAllNodes<IssueSummary, IssuesResult>(
    ISSUES_QUERY,
    (data) => data.issues,
    await credentialOptions(options.debug),
    {
      filter: Object.keys(filter).length ? filter : undefined,
      includeArchived: options.includeArchived ?? false,
    },
  );
}

function plannedChange(from: unknown, to: unknown): { from: unknown; to: unknown } | undefined {
  return Object.is(from, to) ? undefined : { from, to };
}

export async function updateIssue(
  ref: string,
  options: IssueUpdateOptions,
): Promise<IssueMutationData> {
  const issue = await getIssue(ref, options);
  const description = await readOptionalText(
    options.description,
    options.descriptionFile,
    "description",
  );
  const state = await resolveState(options.state, issue.team, options);
  const assignee = await resolveAssignee(options.assignee, options);
  const labels = await resolveLabels(options.label, issue.team, options);
  const priority = parsePriority(options.priority);
  const parent = await resolveParentForUpdate(options.parent, options);

  const input: Record<string, unknown> = {};
  const plannedChanges: Record<string, { from: unknown; to: unknown }> = {};

  const add = (field: string, from: unknown, to: unknown, inputField: string = field) => {
    if (to === undefined) return;
    const change = plannedChange(from, to);
    if (!change) return;
    plannedChanges[field] = change;
    input[inputField] = to;
  };

  add("title", issue.title, options.title);
  add("description", issue.description, description);
  if (state && state.id !== issue.state.id) {
    plannedChanges.state = { from: issue.state.name, to: state.name };
    input.stateId = state.id;
  }
  add(
    "assignee",
    issue.assignee?.email ?? null,
    assignee === undefined ? undefined : (assignee?.email ?? null),
    "assigneeId",
  );
  if (assignee !== undefined) input.assigneeId = assignee?.id ?? null;
  add("priority", issue.priority, priority);
  if (parent !== undefined) {
    const nextParentId = parent?.id ?? null;
    const change = plannedChange(issue.parent?.id ?? null, nextParentId);
    if (change) {
      plannedChanges.parent = {
        from: issue.parent?.identifier ?? null,
        to: parent?.identifier ?? null,
      };
      input.parentId = nextParentId;
    }
  }
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

  if (Object.keys(input).length === 0) {
    return { applied: false, issue, input, plannedChanges };
  }
  if (!options.apply) {
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
  const project = await resolveProject(options.project, team, options);
  const priority = parsePriority(options.priority);
  const parent = await resolveParentForCreate(options.parent, options);

  const input: Record<string, unknown> = { teamId: team.id, title: options.title };
  if (description !== undefined) input.description = description;
  if (state) input.stateId = state.id;
  if (assignee !== undefined) input.assigneeId = assignee?.id ?? null;
  if (labels) input.labelIds = labels.map((label) => label.id);
  if (project) input.projectId = project.id;
  if (parent) input.parentId = parent.id;
  if (priority !== undefined) input.priority = priority;

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

export function formatIssue(issue: IssueSummary): string {
  const labels = issue.labels.nodes.map((label) => label.name).join(", ") || "(none)";
  const parent = issue.parent ? `${issue.parent.identifier} ${issue.parent.title}` : "(none)";
  return [
    `${issue.identifier} ${issue.title}`,
    `State: ${issue.state.name} (${issue.state.type})`,
    `Team: ${issue.team.key} ${issue.team.name}`,
    `Assignee: ${issue.assignee ? `${issue.assignee.name} <${issue.assignee.email}>` : "(unassigned)"}`,
    `Priority: ${issue.priorityLabel}`,
    `Parent: ${parent}`,
    `Labels: ${labels}`,
    `URL: ${issue.url}`,
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
    })),
    columns: ["id", "title", "state", "assignee", "priority"],
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
