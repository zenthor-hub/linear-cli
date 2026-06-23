import { resolveCredential } from "../config.ts";
import { ConfigError } from "../errors.ts";
import { USERS_QUERY, type User, type UsersResult } from "../graphql/documents.ts";
import { fetchAllNodes } from "../graphql/paginate.ts";

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

export async function listUsers(options: UsersListOptions): Promise<User[]> {
  if (options.activeOnly && options.inactiveOnly) {
    throw new ConfigError("Use either --active or --inactive, not both.");
  }
  const credential = resolveCredential();
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
