import { readFile } from "node:fs/promises";

import { ConfigError } from "../errors.ts";
import { executeGraphql } from "../graphql/client.ts";
import {
  PROJECT_BY_ID_QUERY,
  PROJECT_REFERENCE_BY_ID_QUERY,
  PROJECT_STATUSES_QUERY,
  PROJECT_UPDATE,
  PROJECT_UPDATE_CREATE,
  PROJECT_UPDATES_QUERY,
  PROJECTS_QUERY,
  PROJECTS_DETAIL_QUERY,
  type Project,
  type ProjectByIdResult,
  type ProjectReference,
  type ProjectReferenceByIdResult,
  type ProjectStatus,
  type ProjectStatusesResult,
  type ProjectUpdate,
  type ProjectUpdateCreateResult,
  type ProjectUpdateHealth,
  type ProjectUpdateResult,
  type ProjectUpdatesResult,
  type ProjectReferencesResult,
  type ProjectsResult,
} from "../graphql/documents.ts";
import { fetchAllNodes, fetchNodes } from "../graphql/paginate.ts";
import { parsePositiveLimit } from "./issues.ts";
import { credentialOptions, singleMatch } from "./shared.ts";
import { resolveTeam } from "./teams.ts";

export interface ProjectCommandOptions {
  debug?: boolean;
  team?: string;
  includeArchived?: boolean;
  limit?: number;
}

export interface ProjectUpdateOptions extends ProjectCommandOptions {
  name?: string;
  description?: string;
  descriptionFile?: string;
  status?: string;
  startDate?: string;
  targetDate?: string;
  apply?: boolean;
}

export interface ProjectMutationData {
  applied: boolean;
  project: Project;
  input: Record<string, unknown>;
  plannedChanges: Record<string, { from: unknown; to: unknown }>;
  result?: Project;
}

export interface ProjectPostUpdateOptions extends ProjectCommandOptions {
  body?: string;
  bodyFile?: string;
  health: string;
  apply?: boolean;
}

export interface ProjectPostUpdateData {
  applied: boolean;
  project: Project;
  input: Record<string, unknown>;
  plannedChanges: Record<string, { from: unknown; to: unknown }>;
  result?: ProjectUpdate;
}

export interface ProjectUpdatesData {
  project: ProjectReference;
  updates: ProjectUpdate[];
}

const DEFAULT_PROJECT_UPDATES_LIMIT = 50;
export const PROJECT_DESCRIPTION_MAX_LENGTH = 255;
const PROJECT_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

function parseProjectDate(value: string | undefined, field: string): string | null | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (["none", "null", "clear"].includes(normalized)) return null;
  const date = value.trim();
  if (!PROJECT_DATE_RE.test(date)) {
    throw new ConfigError(`Project ${field} must be YYYY-MM-DD, or none to clear.`);
  }
  const [yearText, monthText, dayText] = date.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    throw new ConfigError(`Project ${field} must be a valid YYYY-MM-DD date, or none to clear.`);
  }
  return date;
}

function validateProjectDescription(description: string | undefined): void {
  if (
    description !== undefined &&
    Array.from(description).length > PROJECT_DESCRIPTION_MAX_LENGTH
  ) {
    throw new ConfigError(
      `Project description must be ${PROJECT_DESCRIPTION_MAX_LENGTH} Unicode characters or fewer.`,
    );
  }
}

export function parseProjectUpdateHealth(value: string): ProjectUpdateHealth {
  if (value === "onTrack" || value === "atRisk" || value === "offTrack") return value;
  throw new ConfigError("Project-update health must be one of onTrack, atRisk, or offTrack.");
}

function projectFilter(team: { id: string } | undefined): Record<string, unknown> | undefined {
  return team ? { accessibleTeams: { some: { id: { eq: team.id } } } } : undefined;
}

function matchProject<T extends ProjectReference>(projects: T[], ref: string, teamKey?: string): T {
  const normalized = ref.toLowerCase();
  const matches = projects.filter(
    (project) => project.id === ref || project.name.toLowerCase() === normalized,
  );
  const emptyMessage = teamKey
    ? `No project found for ${teamKey}: ${ref}`
    : `No project found for: ${ref}`;
  const ambiguousMessage = teamKey
    ? `Project reference is ambiguous for ${teamKey}: ${ref}`
    : `Project reference is ambiguous: ${ref}`;
  return singleMatch(matches, emptyMessage, ambiguousMessage);
}

function applyArchivePolicy<T extends ProjectReference>(
  projects: T[],
  includeArchived: boolean,
): T[] {
  return includeArchived ? projects : projects.filter((project) => project.archivedAt === null);
}

interface ProjectResolutionScope {
  team?: { id: string; key: string };
  includeArchived: boolean;
  debug?: boolean;
}

async function resolveProjectReferenceInScope(
  ref: string,
  scope: ProjectResolutionScope,
): Promise<ProjectReference> {
  if (/^[0-9a-f-]{20,}$/i.test(ref) && !scope.team) {
    const data = await executeGraphql<ProjectReferenceByIdResult>(
      PROJECT_REFERENCE_BY_ID_QUERY,
      { id: ref },
      await credentialOptions(scope.debug),
    );
    if (data.project && (scope.includeArchived || data.project.archivedAt === null)) {
      return data.project;
    }
  }

  const projects = await fetchAllNodes<ProjectReference, ProjectReferencesResult>(
    PROJECTS_QUERY,
    (data) => data.projects,
    await credentialOptions(scope.debug),
    {
      filter: projectFilter(scope.team),
      includeArchived: scope.includeArchived,
    },
  );
  return matchProject(applyArchivePolicy(projects, scope.includeArchived), ref, scope.team?.key);
}

export async function resolveProjectReference(
  ref: string,
  options: ProjectCommandOptions = {},
): Promise<ProjectReference> {
  const team = options.team ? await resolveTeam(options.team, options) : undefined;
  return resolveProjectReferenceInScope(ref, {
    team,
    includeArchived: options.includeArchived ?? false,
    debug: options.debug,
  });
}

export async function listProjects(
  options: ProjectCommandOptions = {},
): Promise<ProjectReference[]> {
  const limit = parsePositiveLimit(options.limit);
  const team = options.team ? await resolveTeam(options.team, options) : undefined;

  return fetchNodes<ProjectReference, ProjectReferencesResult>(
    PROJECTS_QUERY,
    (data) => data.projects,
    await credentialOptions(options.debug),
    {
      filter: projectFilter(team),
      includeArchived: options.includeArchived ?? false,
    },
    { limit },
  );
}

export async function getProject(
  ref: string,
  options: ProjectCommandOptions = {},
): Promise<Project> {
  const includeArchived = options.includeArchived ?? true;
  // UUID-ish or Linear model IDs: try direct lookup first when it looks like an id.
  if (/^[0-9a-f-]{20,}$/i.test(ref)) {
    const data = await executeGraphql<ProjectByIdResult>(
      PROJECT_BY_ID_QUERY,
      { id: ref },
      await credentialOptions(options.debug),
    );
    if (data.project && (includeArchived || data.project.archivedAt === null)) {
      return data.project;
    }
  }

  const team = options.team ? await resolveTeam(options.team, options) : undefined;
  const projects = await fetchAllNodes<Project, ProjectsResult>(
    PROJECTS_DETAIL_QUERY,
    (data) => data.projects,
    await credentialOptions(options.debug),
    {
      filter: projectFilter(team),
      includeArchived,
    },
  );
  return matchProject(applyArchivePolicy(projects, includeArchived), ref, team?.key);
}

export async function resolveProject(
  projectRef: string,
  team: { id: string; key: string },
  opts: { debug?: boolean; includeArchived?: boolean },
): Promise<ProjectReference> {
  return resolveProjectReferenceInScope(projectRef, {
    team,
    includeArchived: opts.includeArchived ?? false,
    debug: opts.debug,
  });
}

export async function listProjectStatuses(
  options: {
    debug?: boolean;
    includeArchived?: boolean;
  } = {},
): Promise<ProjectStatus[]> {
  return fetchAllNodes<ProjectStatus, ProjectStatusesResult>(
    PROJECT_STATUSES_QUERY,
    (data) => data.projectStatuses,
    await credentialOptions(options.debug),
    { includeArchived: options.includeArchived ?? false },
  );
}

export async function resolveProjectStatus(
  statusRef: string,
  options: { debug?: boolean } = {},
): Promise<ProjectStatus> {
  const normalized = statusRef.trim().toLowerCase();
  if (!normalized) throw new ConfigError("Project status reference is required.");
  const statuses = await listProjectStatuses(options);
  const matches = statuses.filter(
    (status) =>
      status.id === statusRef ||
      status.name.toLowerCase() === normalized ||
      status.type.toLowerCase() === normalized,
  );
  return singleMatch(
    matches,
    `No project status found for: ${statusRef}`,
    `Project status reference is ambiguous: ${statusRef}`,
  );
}

function applyProjectScalarChange(
  input: Record<string, unknown>,
  plannedChanges: Record<string, { from: unknown; to: unknown }>,
  field: string,
  from: unknown,
  to: unknown,
): void {
  if (to === undefined || Object.is(from, to)) return;
  input[field] = to;
  plannedChanges[field] = { from, to };
}

function buildProjectUpdatePlan(
  project: Project,
  options: ProjectUpdateOptions,
  description: string | undefined,
  status: ProjectStatus | undefined,
  startDate: string | null | undefined,
  targetDate: string | null | undefined,
): {
  input: Record<string, unknown>;
  plannedChanges: Record<string, { from: unknown; to: unknown }>;
} {
  const input: Record<string, unknown> = {};
  const plannedChanges: Record<string, { from: unknown; to: unknown }> = {};

  applyProjectScalarChange(input, plannedChanges, "name", project.name, options.name);
  applyProjectScalarChange(
    input,
    plannedChanges,
    "description",
    project.description ?? null,
    description,
  );
  if (status && status.id !== project.status.id) {
    input.statusId = status.id;
    plannedChanges.status = { from: project.status.name, to: status.name };
  }
  applyProjectScalarChange(
    input,
    plannedChanges,
    "startDate",
    project.startDate ?? null,
    startDate,
  );
  applyProjectScalarChange(
    input,
    plannedChanges,
    "targetDate",
    project.targetDate ?? null,
    targetDate,
  );

  return { input, plannedChanges };
}

export async function updateProject(
  ref: string,
  options: ProjectUpdateOptions = {},
): Promise<ProjectMutationData> {
  const project = await getProject(ref, options);
  const description = await readOptionalText(
    options.description,
    options.descriptionFile,
    "description",
  );
  validateProjectDescription(description);
  if (options.name !== undefined && !options.name.trim()) {
    throw new ConfigError("Project name cannot be empty.");
  }
  const status = options.status
    ? await resolveProjectStatus(options.status, { debug: options.debug })
    : undefined;
  const startDate = parseProjectDate(options.startDate, "start date");
  const targetDate = parseProjectDate(options.targetDate, "target date");
  const { input, plannedChanges } = buildProjectUpdatePlan(
    project,
    options,
    description,
    status,
    startDate,
    targetDate,
  );

  if (Object.keys(input).length === 0 || !options.apply) {
    return { applied: false, project, input, plannedChanges };
  }

  const result = await executeGraphql<ProjectUpdateResult>(
    PROJECT_UPDATE,
    { id: project.id, input },
    await credentialOptions(options.debug),
  );
  if (!result.projectUpdate.success || !result.projectUpdate.project) {
    throw new ConfigError("Linear reported the project was not updated.");
  }
  return {
    applied: true,
    project,
    input,
    plannedChanges,
    result: result.projectUpdate.project,
  };
}

export async function postProjectUpdate(
  ref: string,
  options: ProjectPostUpdateOptions,
): Promise<ProjectPostUpdateData> {
  const project = await getProject(ref, options);
  const body = await readOptionalText(options.body, options.bodyFile, "body");
  if (!body?.trim()) {
    throw new ConfigError("Project update body is required. Use --body or --body-file.");
  }
  const health = parseProjectUpdateHealth(options.health);
  const input = { projectId: project.id, body, health };
  const plannedChanges: Record<string, { from: unknown; to: unknown }> = {
    body: { from: null, to: body },
    health: { from: project.health ?? null, to: health },
  };

  if (!options.apply) {
    return { applied: false, project, input, plannedChanges };
  }

  const result = await executeGraphql<ProjectUpdateCreateResult>(
    PROJECT_UPDATE_CREATE,
    { input },
    await credentialOptions(options.debug),
  );
  if (!result.projectUpdateCreate.success || !result.projectUpdateCreate.projectUpdate) {
    throw new ConfigError("Linear reported the project update was not created.");
  }
  return {
    applied: true,
    project,
    input,
    plannedChanges,
    result: result.projectUpdateCreate.projectUpdate,
  };
}

export async function listProjectUpdates(
  ref: string,
  options: ProjectCommandOptions = {},
): Promise<ProjectUpdatesData> {
  const includeArchived = options.includeArchived ?? false;
  const project = await resolveProjectReference(ref, { ...options, includeArchived });
  const limit = parsePositiveLimit(options.limit, DEFAULT_PROJECT_UPDATES_LIMIT);
  const updates = await fetchNodes<ProjectUpdate, ProjectUpdatesResult>(
    PROJECT_UPDATES_QUERY,
    (data) => data.projectUpdates,
    await credentialOptions(options.debug),
    {
      filter: { project: { id: { eq: project.id } } },
      includeArchived,
    },
    { limit },
  );
  return { project, updates };
}

export function formatProject(project: Project): string {
  const updates = project.projectUpdates ?? [];
  const latest = updates[0];
  return [
    project.name,
    `Status: ${project.status.name} (${project.status.type})`,
    `State: ${project.state}`,
    `Health: ${project.health ?? "(none)"}`,
    `Dates: ${project.startDate ?? "(no start)"} -> ${project.targetDate ?? "(no target)"}`,
    `Description: ${project.description ?? "(none)"}`,
    `Recent updates: ${updates.length}${latest ? ` (latest ${latest.health}, ${latest.createdAt.slice(0, 10)})` : ""}`,
    `URL: ${project.url}`,
    `ID: ${project.id}`,
  ].join("\n");
}

export function formatProjectsList(projects: ProjectReference[]): {
  rows: Record<string, unknown>[];
  columns: string[];
} {
  return {
    rows: projects.map((project) => ({
      name: project.name,
      status: project.status.name,
      state: project.state,
      id: project.id,
    })),
    columns: ["name", "status", "state", "id"],
  };
}

function updateBodyPreview(body: string): string {
  const oneLine = body.replace(/\s+/g, " ").trim();
  return oneLine.length > 80 ? `${oneLine.slice(0, 77)}...` : oneLine;
}

export function formatProjectUpdatesList(updates: ProjectUpdate[]): {
  rows: Record<string, unknown>[];
  columns: string[];
} {
  return {
    rows: updates.map((update) => ({
      id: update.id,
      health: update.health,
      created: update.createdAt.slice(0, 10),
      body: updateBodyPreview(update.body),
      url: update.url,
    })),
    columns: ["id", "health", "created", "body", "url"],
  };
}
