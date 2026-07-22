import { resolveCredential } from "../config.ts";
import { ConfigError } from "../errors.ts";
import { executeGraphql } from "../graphql/client.ts";
import {
  USERS_QUERY,
  VIEWER_USER_QUERY,
  type User,
  type UsersResult,
  type ViewerUserResult,
} from "../graphql/documents.ts";
import { fetchAllNodes } from "../graphql/paginate.ts";
import { singleMatch } from "./shared.ts";

export interface UsersListOptions {
  includeArchived?: boolean;
  /** Only admins. */
  adminOnly?: boolean;
  /** Only active users. Mutually exclusive with `inactiveOnly`. */
  activeOnly?: boolean;
  /** Only deactivated (suspended) users. Mutually exclusive with `activeOnly`. */
  inactiveOnly?: boolean;
  debug?: boolean;
}

export interface ResolveUserOptions {
  debug?: boolean;
  /** Override empty-match error message. */
  emptyMessage?: string;
  /** Override ambiguous-match error message. */
  ambiguousMessage?: string;
}

export async function listUsers(options: UsersListOptions): Promise<User[]> {
  if (options.activeOnly && options.inactiveOnly) {
    throw new ConfigError("Use either --active or --inactive, not both.");
  }
  const credential = await resolveCredential();
  const users = await fetchAllNodes<User, UsersResult>(
    USERS_QUERY,
    (data) => data.users,
    { credential, debug: options.debug },
    { includeArchived: options.includeArchived ?? false },
  );
  return users.filter((u) => {
    if (options.adminOnly && !u.admin) return false;
    if (options.activeOnly && !u.active) return false;
    if (options.inactiveOnly && u.active) return false;
    return true;
  });
}

/** Resolve the authenticated viewer (full User fields). */
export async function resolveViewer(options: { debug?: boolean } = {}): Promise<User> {
  const credential = await resolveCredential();
  const data = await executeGraphql<ViewerUserResult>(
    VIEWER_USER_QUERY,
    {},
    { credential, debug: options.debug },
  );
  return data.viewer;
}

const UUID_RE = /^[0-9a-f-]{20,}$/i;

/**
 * Resolve a user by ID, email, name, or the special token `me`.
 * Shared by issue assignee resolution and notification subscriptions.
 *
 * Uses a server-side filter (by ID or by email/name) instead of paging the
 * entire workspace directory, so lookups cost one request regardless of
 * workspace size.
 */
export async function resolveUser(
  userRefRaw: string,
  options: ResolveUserOptions = {},
): Promise<User> {
  const userRef = userRefRaw.trim();
  if (!userRef) {
    throw new ConfigError("A user reference is required.");
  }
  if (userRef.toLowerCase() === "me") {
    return resolveViewer({ debug: options.debug });
  }

  const filter = UUID_RE.test(userRef)
    ? { id: { eq: userRef } }
    : { or: [{ email: { eqIgnoreCase: userRef } }, { name: { eqIgnoreCase: userRef } }] };

  const credential = await resolveCredential();
  const data = await executeGraphql<UsersResult>(
    USERS_QUERY,
    { includeArchived: false, filter },
    { credential, debug: options.debug },
  );
  return singleMatch(
    data.users.nodes,
    options.emptyMessage ?? `No user found for: ${userRef}`,
    options.ambiguousMessage ?? `User reference is ambiguous: ${userRef}`,
  );
}

export function formatUsersList(users: User[]): {
  rows: Record<string, unknown>[];
  columns: string[];
} {
  const rows = users.map((u) => ({
    name: u.name,
    email: u.email,
    admin: u.admin ? "yes" : "no",
    active: u.active ? "yes" : "no",
    archived: u.archivedAt ? "yes" : "no",
    id: u.id,
  }));
  return { rows, columns: ["name", "email", "admin", "active", "archived", "id"] };
}
