import { resolveCredential } from "../config.ts";
import { ConfigError } from "../errors.ts";
import { CYCLES_QUERY, type Cycle, type CyclesResult, type Team } from "../graphql/documents.ts";
import { fetchAllNodes, fetchNodes } from "../graphql/paginate.ts";
import { parsePositiveLimit } from "./issues.ts";
import { listTeams } from "./teams.ts";

export interface CycleCommandOptions {
  debug?: boolean;
  team?: string;
  includeArchived?: boolean;
  limit?: number;
  /** Only active / next / past / future cycles when set. */
  only?: "active" | "next" | "past" | "future";
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

export async function listCycles(options: CycleCommandOptions = {}): Promise<Cycle[]> {
  if (!options.team) {
    throw new ConfigError("--team is required to list cycles.");
  }
  const limit = parsePositiveLimit(options.limit);
  const team = await resolveTeamRef(options.team, options);
  const filter: Record<string, unknown> = {
    team: { id: { eq: team.id } },
  };
  if (options.only === "active") filter.isActive = { eq: true };
  if (options.only === "next") filter.isNext = { eq: true };
  if (options.only === "past") filter.isPast = { eq: true };
  if (options.only === "future") filter.isFuture = { eq: true };

  return fetchNodes<Cycle, CyclesResult>(
    CYCLES_QUERY,
    (data) => data.cycles,
    await credentialOptions(options.debug),
    {
      filter,
      includeArchived: options.includeArchived ?? false,
    },
    { limit },
  );
}

export async function resolveCycle(
  cycleRef: string,
  team: { id: string; key: string },
  opts: { debug?: boolean },
): Promise<Cycle> {
  const cycles = await fetchAllNodes<Cycle, CyclesResult>(
    CYCLES_QUERY,
    (data) => data.cycles,
    await credentialOptions(opts.debug),
    {
      filter: { team: { id: { eq: team.id } } },
      includeArchived: false,
    },
  );
  const normalized = cycleRef.toLowerCase();
  const matches = cycles.filter((cycle) => {
    if (cycle.id === cycleRef) return true;
    if (String(cycle.number) === cycleRef) return true;
    if (cycle.name?.toLowerCase() === normalized) return true;
    if (normalized === "active" && cycle.isActive) return true;
    if (normalized === "next" && cycle.isNext) return true;
    return false;
  });
  return singleMatch(
    matches,
    `No cycle found for ${team.key}: ${cycleRef}`,
    `Cycle reference is ambiguous for ${team.key}: ${cycleRef}`,
  );
}

export function formatCyclesList(cycles: Cycle[]): {
  rows: Record<string, unknown>[];
  columns: string[];
} {
  return {
    rows: cycles.map((cycle) => ({
      team: cycle.team.key,
      number: cycle.number,
      name: cycle.name ?? "",
      active: cycle.isActive,
      next: cycle.isNext,
      starts: cycle.startsAt,
      ends: cycle.endsAt,
      id: cycle.id,
    })),
    columns: ["team", "number", "name", "active", "next", "starts", "ends", "id"],
  };
}
