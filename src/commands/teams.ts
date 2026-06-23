import { resolveCredential } from "../config.ts";
import { ConfigError } from "../errors.ts";
import { TEAMS_QUERY, type Team, type TeamsResult } from "../graphql/documents.ts";
import { fetchAllNodes } from "../graphql/paginate.ts";

export interface TeamsListOptions {
  includeArchived?: boolean;
  /** Only private teams. Mutually exclusive with `publicOnly`. */
  privateOnly?: boolean;
  /** Only public teams. Mutually exclusive with `privateOnly`. */
  publicOnly?: boolean;
  debug?: boolean;
}

export async function listTeams(options: TeamsListOptions): Promise<Team[]> {
  if (options.privateOnly && options.publicOnly) {
    throw new ConfigError("Use either --private or --public, not both.");
  }
  const credential = resolveCredential();
  const teams = await fetchAllNodes<Team, TeamsResult>(
    TEAMS_QUERY,
    (data) => data.teams,
    { credential, debug: options.debug },
    { includeArchived: options.includeArchived ?? false },
  );
  return teams.filter((t) => {
    if (options.privateOnly && !t.private) return false;
    if (options.publicOnly && t.private) return false;
    return true;
  });
}

export function formatTeamsList(teams: Team[]): {
  rows: Record<string, unknown>[];
  columns: string[];
} {
  const rows = teams.map((t) => ({
    key: t.key,
    name: t.name,
    visibility: t.private ? "private" : "public",
    archived: t.archivedAt ? "yes" : "no",
    id: t.id,
  }));
  return { rows, columns: ["key", "name", "visibility", "archived", "id"] };
}
