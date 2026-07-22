import { ConfigError } from "../../errors.ts";
import { executeGraphql } from "../../graphql/client.ts";
import {
  NOTIFICATION_QUERY,
  NOTIFICATIONS_QUERY,
  NOTIFICATIONS_UNREAD_COUNT_QUERY,
  type Notification,
  type NotificationResult,
  type NotificationsResult,
  type NotificationsUnreadCountResult,
} from "../../graphql/documents.ts";
import { fetchNodes } from "../../graphql/paginate.ts";
import { parsePositiveLimit } from "../issues.ts";
import {
  DEFAULT_NOTIFICATION_LIST_LIMIT,
  MAX_CLIENT_FILTER_PAGES,
  NOTIFICATION_CATEGORIES,
  type NotificationCategory,
} from "./constants.ts";
import {
  credentialOptions,
  eqOrIn,
  normalizeStringList,
  parseEnumValue,
  parseIsoTimestamp,
  validateSubscriptionTypes,
} from "./helpers.ts";

export interface NotificationListOptions {
  limit?: number;
  includeArchived?: boolean;
  /** Notification type(s); single value or list (server `eq` / `in`). */
  type?: string | string[];
  /** Client-side unread filter (`readAt == null`); pages until filled. */
  unread?: boolean;
  /** Client-side category filter (not available on NotificationFilter). */
  category?: string;
  /** ISO lower bound for createdAt (`gte`). */
  since?: string;
  /** ISO upper bound for createdAt (`lte`). */
  before?: string;
  /** Server subscriptionType filter (`eq` / `in`). */
  subscriptionType?: string | string[];
  debug?: boolean;
}

function buildNotificationFilter(
  options: NotificationListOptions,
): Record<string, unknown> | undefined {
  const filter: Record<string, unknown> = {};

  const typeFilter = eqOrIn(normalizeStringList(options.type));
  if (typeFilter) filter.type = typeFilter;

  const subscriptionTypes = validateSubscriptionTypes(
    normalizeStringList(options.subscriptionType),
    "--subscription-type",
  );
  const subscriptionTypeFilter = eqOrIn(subscriptionTypes ?? []);
  if (subscriptionTypeFilter) filter.subscriptionType = subscriptionTypeFilter;

  const createdAt: Record<string, string> = {};
  if (options.since) {
    createdAt.gte = parseIsoTimestamp(options.since, "--since");
  }
  if (options.before) {
    createdAt.lte = parseIsoTimestamp(options.before, "--before");
  }
  if (createdAt.gte && createdAt.lte && createdAt.gte > createdAt.lte) {
    throw new ConfigError("--since must be earlier than or equal to --before.");
  }
  if (Object.keys(createdAt).length > 0) {
    filter.createdAt = createdAt;
  }

  return Object.keys(filter).length ? filter : undefined;
}

function matchesClientFilters(
  notification: Notification,
  options: { unread?: boolean; category?: NotificationCategory },
): boolean {
  if (options.unread && notification.readAt != null) return false;
  if (options.category && notification.category !== options.category) return false;
  return true;
}

export async function listNotifications(
  options: NotificationListOptions = {},
): Promise<Notification[]> {
  const limit =
    parsePositiveLimit(options.limit, DEFAULT_NOTIFICATION_LIST_LIMIT) ??
    DEFAULT_NOTIFICATION_LIST_LIMIT;

  let category: NotificationCategory | undefined;
  if (options.category !== undefined) {
    const normalized = options.category.trim();
    if (!normalized) throw new ConfigError("--category must be a non-empty string.");
    category = parseEnumValue(normalized, NOTIFICATION_CATEGORIES, "--category");
  }

  const filter = buildNotificationFilter(options);
  const needsClientFilter = Boolean(options.unread || category);
  const clientOptions = { unread: options.unread, category };

  return fetchNodes<Notification, NotificationsResult>(
    NOTIFICATIONS_QUERY,
    (data) => data.notifications,
    await credentialOptions(options.debug),
    {
      filter,
      includeArchived: options.includeArchived ?? false,
      orderBy: "createdAt",
    },
    {
      limit,
      maxPages: needsClientFilter ? MAX_CLIENT_FILTER_PAGES : undefined,
      match: needsClientFilter
        ? (notification) => matchesClientFilters(notification, clientOptions)
        : undefined,
      maxPagesExceededMessage: needsClientFilter
        ? (collected: number) =>
            `Client-side notification filter scan hit the ${MAX_CLIENT_FILTER_PAGES}-page cap having collected ${collected} of the requested ${limit} matches. Narrow with --since/--before/--type/--subscription-type, raise selectivity, or page with a smaller --limit.`
        : undefined,
    },
  );
}

export async function getNotification(
  id: string,
  options: { debug?: boolean } = {},
): Promise<Notification> {
  if (!id.trim()) throw new ConfigError("A notification ID is required.");
  const data = await executeGraphql<NotificationResult>(
    NOTIFICATION_QUERY,
    { id },
    await credentialOptions(options.debug),
  );
  if (!data.notification) {
    throw new ConfigError(`No notification found with ID: ${id}`);
  }
  return data.notification;
}

export async function getUnreadCount(options: { debug?: boolean } = {}): Promise<number> {
  const data = await executeGraphql<NotificationsUnreadCountResult>(
    NOTIFICATIONS_UNREAD_COUNT_QUERY,
    {},
    await credentialOptions(options.debug),
  );
  return data.notificationsUnreadCount;
}
