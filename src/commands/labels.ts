import { ConfigError } from "../errors.ts";
import { executeGraphql } from "../graphql/client.ts";
import {
  ISSUE_LABEL_CREATE,
  ISSUE_LABELS_QUERY,
  type IssueLabel,
  type IssueLabelCreateInput,
  type IssueLabelCreateResult,
  type IssueLabelsResult,
  type Team,
} from "../graphql/documents.ts";
import { fetchAllNodes } from "../graphql/paginate.ts";
import { credentialOptions, singleMatch } from "./shared.ts";
import { resolveTeam } from "./teams.ts";

export type TeamRef = Pick<Team, "id" | "key">;

/**
 * Label scope matrix used by list + create:
 *
 * | Operation              | Workspace create     | Team create                         | list --team            | list (no team) |
 * |------------------------|----------------------|-------------------------------------|------------------------|----------------|
 * | Candidates fetched     | team == null only    | that team OR workspace              | team (± workspace)     | unfiltered     |
 * | Duplicate uniqueness   | workspace names      | names on that team only             | n/a                    | n/a            |
 * | Parent candidates      | workspace only       | that team + workspace               | n/a                    | n/a            |
 * | --replace-team-labels  | allowed              | rejected                            | n/a                    | n/a            |
 *
 * Same display name on workspace vs a team is allowed (different scopes).
 * Linear's replaceTeamLabels promotes a workspace name over team duplicates.
 */

export interface ListLabelsOptions {
  /** Team key/name/ID. Ignored when `resolvedTeam` is set. */
  team?: string;
  /**
   * Pre-resolved team. Prefer this after `resolveTeam` so listLabels does not
   * resolve the same team a second time.
   */
  resolvedTeam?: TeamRef;
  /** Include workspace labels when filtering by team (default false for list CLI). */
  includeWorkspace?: boolean;
  /** Only workspace-level labels (`team: null`). Mutually exclusive with team filters. */
  workspaceOnly?: boolean;
  debug?: boolean;
}

export async function listLabels(options: ListLabelsOptions = {}): Promise<IssueLabel[]> {
  if (options.workspaceOnly && (options.team || options.resolvedTeam)) {
    throw new ConfigError("Cannot combine workspaceOnly with a team filter.");
  }

  let filter: Record<string, unknown> | undefined;
  if (options.workspaceOnly) {
    filter = { team: { null: true } };
  } else {
    const team =
      options.resolvedTeam ?? (options.team ? await resolveTeam(options.team, options) : undefined);
    if (team) {
      filter = options.includeWorkspace
        ? { or: [{ team: { key: { eq: team.key } } }, { team: { null: true } }] }
        : { team: { key: { eq: team.key } } };
    }
  }

  return fetchAllNodes<IssueLabel, IssueLabelsResult>(
    ISSUE_LABELS_QUERY,
    (data) => data.issueLabels,
    await credentialOptions(options.debug),
    { filter },
  );
}

export interface LabelCreateOptions {
  name: string;
  color?: string;
  description?: string;
  /** Team key/name/ID for a team-scoped label. Omit for a workspace label. */
  team?: string;
  /** Parent label group name or ID (workspace, or same team when creating team-scoped). */
  parent?: string;
  /** When creating a workspace label, replace same-named team labels (Linear API). */
  replaceTeamLabels?: boolean;
  apply?: boolean;
  debug?: boolean;
}

export interface LabelCreateData {
  applied: boolean;
  input: IssueLabelCreateInput;
  replaceTeamLabels?: boolean;
  result?: IssueLabel;
}

const LABEL_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function parseLabelColor(color: string | undefined): string | undefined {
  if (color === undefined) return undefined;
  const trimmed = color.trim();
  if (!LABEL_COLOR_RE.test(trimmed)) {
    throw new ConfigError("Label --color must be a hex color like #0ea5e9 or #fff.");
  }
  return trimmed;
}

function matchLabelRef(label: IssueLabel, ref: string): boolean {
  return label.id === ref || label.name.toLowerCase() === ref.toLowerCase();
}

function resolveParentLabel(ref: string, candidates: IssueLabel[]): IssueLabel {
  const parentRef = ref.trim();
  if (!parentRef) {
    throw new ConfigError("Parent label reference is required when --parent is set.");
  }
  const matches = candidates.filter((label) => matchLabelRef(label, parentRef));
  return singleMatch(
    matches,
    `No parent label found for: ${ref}`,
    `Parent label reference is ambiguous: ${ref}`,
  );
}

/**
 * Create an issue label (workspace by default, or team-scoped with --team).
 * Dry-run unless apply is true.
 */
export async function createLabel(options: LabelCreateOptions): Promise<LabelCreateData> {
  const name = options.name.trim();
  if (!name) throw new ConfigError("Label name is required.");

  if (options.replaceTeamLabels && options.team) {
    throw new ConfigError(
      "--replace-team-labels only applies when creating a workspace label (omit --team).",
    );
  }
  if (options.parent !== undefined && !options.parent.trim()) {
    throw new ConfigError("Parent label reference is required when --parent is set.");
  }

  const color = parseLabelColor(options.color);
  const description = options.description?.trim() || undefined;
  const team = options.team ? await resolveTeam(options.team, options) : undefined;

  // One scoped fetch: workspace-only for workspace create; team+workspace for team create.
  const available = team
    ? await listLabels({
        resolvedTeam: team,
        includeWorkspace: true,
        debug: options.debug,
      })
    : await listLabels({ workspaceOnly: true, debug: options.debug });

  const normalized = name.toLowerCase();
  const existing = available.find((label) => {
    if (label.name.toLowerCase() !== normalized) return false;
    if (team) return label.team?.id === team.id;
    return label.team === null;
  });
  if (existing) {
    const scope = team ? `team ${team.key}` : "workspace";
    throw new ConfigError(`Label already exists in ${scope}: ${existing.name} (${existing.id})`);
  }

  let parentId: string | undefined;
  if (options.parent !== undefined) {
    // Parent universe matches the scoped fetch (workspace-only, or team ∪ workspace).
    parentId = resolveParentLabel(options.parent, available).id;
  }

  const input: IssueLabelCreateInput = { name };
  if (color !== undefined) input.color = color;
  if (description !== undefined) input.description = description;
  if (team) input.teamId = team.id;
  if (parentId) input.parentId = parentId;

  const replaceTeamLabels = options.replaceTeamLabels ? true : undefined;

  if (!options.apply) {
    return { applied: false, input, replaceTeamLabels };
  }

  const variables: { input: IssueLabelCreateInput; replaceTeamLabels?: boolean } = { input };
  if (replaceTeamLabels) variables.replaceTeamLabels = true;

  const result = await executeGraphql<IssueLabelCreateResult>(
    ISSUE_LABEL_CREATE,
    variables,
    await credentialOptions(options.debug),
  );
  if (!result.issueLabelCreate.success) {
    throw new ConfigError("Linear reported the issue label was not created.");
  }
  return {
    applied: true,
    input,
    replaceTeamLabels,
    result: result.issueLabelCreate.issueLabel,
  };
}

/** Resolve label name/id refs for issue create/update on a team. */
export async function resolveLabels(
  labels: string[] | undefined,
  team: TeamRef,
  opts: { debug?: boolean } = {},
): Promise<IssueLabel[] | undefined> {
  if (!labels?.length) return undefined;
  const available = await listLabels({
    resolvedTeam: team,
    includeWorkspace: true,
    debug: opts.debug,
  });
  return labels.map((label) => {
    const matches = available.filter((candidate) => matchLabelRef(candidate, label));
    return singleMatch(
      matches,
      `No label found for ${team.key}: ${label}`,
      `Label reference is ambiguous for ${team.key}: ${label}`,
    );
  });
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
