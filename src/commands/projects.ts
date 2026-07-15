import { resolveCredential } from "../config.ts";
import { ConfigError } from "../errors.ts";
import { executeGraphql } from "../graphql/client.ts";
import {
  PROJECT_BY_ID_QUERY,
  PROJECTS_QUERY,
  type Project,
  type ProjectByIdResult,
  type ProjectsResult,
  type Team,
} from "../graphql/documents.ts";
import { fetchAllNodes, fetchNodes } from "../graphql/paginate.ts";
import { parsePositiveLimit } from "./issues.ts";
import { listTeams } from "./teams.ts";

export interface ProjectCommandOptions {
  debug?: boolean;
  team?: string;
  includeArchived?: boolean;
  limit?: number;
}

function singleMatch<T>(matches: T[], emptyMessage: string, ambiguousMessage: string): T {
  if (matches.length === 0) throw new ConfigError(emptyMessage);
  if (matches.length > 1) throw new ConfigError(ambiguousMessage);
  const match = matches[0];
  if (match === undefined) throw new ConfigError(emptyMessage);
  return match;
}

async function credentialOptions(debug?: boolean) {
  return { credential: await resolveCredential(), debug };
}

async function resolveTeamRef(teamRef: string, opts: { debug?: boolean }): Promise<Team> {
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

export async function listProjects(options: ProjectCommandOptions = {}): Promise<Project[]> {
  const limit = parsePositiveLimit(options.limit);
  const filter: Record<string, unknown> = {};
  if (options.team) {
    const team = await resolveTeamRef(options.team, options);
    filter.accessibleTeams = { some: { id: { eq: team.id } } };
  }

  return fetchNodes<Project, ProjectsResult>(
    PROJECTS_QUERY,
    (data) => data.projects,
    await credentialOptions(options.debug),
    {
      filter: Object.keys(filter).length ? filter : undefined,
      includeArchived: options.includeArchived ?? false,
    },
    { limit },
  );
}

export async function getProject(
  ref: string,
  options: ProjectCommandOptions = {},
): Promise<Project> {
  // UUID-ish or Linear model IDs: try direct lookup first when it looks like an id.
  if (/^[0-9a-f-]{20,}$/i.test(ref)) {
    const data = await executeGraphql<ProjectByIdResult>(
      PROJECT_BY_ID_QUERY,
      { id: ref },
      await credentialOptions(options.debug),
    );
    if (data.project) return data.project;
  }

  const projects = await listProjects({
    team: options.team,
    includeArchived: options.includeArchived ?? true,
    debug: options.debug,
  });
  const normalized = ref.toLowerCase();
  const matches = projects.filter(
    (project) => project.id === ref || project.name.toLowerCase() === normalized,
  );
  return singleMatch(
    matches,
    `No project found for: ${ref}`,
    `Project reference is ambiguous: ${ref}`,
  );
}

export async function resolveProject(
  projectRef: string,
  team: { id: string; key: string },
  opts: { debug?: boolean },
): Promise<Project> {
  const projects = await fetchAllNodes<Project, ProjectsResult>(
    PROJECTS_QUERY,
    (data) => data.projects,
    await credentialOptions(opts.debug),
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

export function formatProject(project: Project): string {
  return [
    project.name,
    `Status: ${project.status.name} (${project.status.type})`,
    `State: ${project.state}`,
    `Description: ${project.description ?? "(none)"}`,
    `URL: ${project.url}`,
    `ID: ${project.id}`,
  ].join("\n");
}

export function formatProjectsList(projects: Project[]): {
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
