import { resolveCredential } from "../config.ts";
import { ConfigError } from "../errors.ts";
import { executeGraphql } from "../graphql/client.ts";
import {
  NOTIFICATION_ARCHIVE,
  NOTIFICATION_ARCHIVE_ALL,
  NOTIFICATION_CATEGORY_CHANNEL_UPDATE,
  NOTIFICATION_MARK_READ_ALL,
  NOTIFICATION_MARK_UNREAD_ALL,
  NOTIFICATION_QUERY,
  NOTIFICATION_SNOOZE_ALL,
  NOTIFICATION_SUBSCRIPTION_CREATE,
  NOTIFICATION_SUBSCRIPTION_QUERY,
  NOTIFICATION_SUBSCRIPTION_UPDATE,
  NOTIFICATION_SUBSCRIPTIONS_QUERY,
  NOTIFICATION_UNARCHIVE,
  NOTIFICATION_UNSNOOZE_ALL,
  NOTIFICATION_UPDATE,
  NOTIFICATIONS_QUERY,
  NOTIFICATIONS_UNREAD_COUNT_QUERY,
  USERS_QUERY,
  type Notification,
  type NotificationArchiveResult,
  type NotificationCategoryChannelUpdateResult,
  type NotificationResult,
  type NotificationSubscription,
  type NotificationSubscriptionCreateResult,
  type NotificationSubscriptionResult,
  type NotificationSubscriptionsResult,
  type NotificationSubscriptionUpdateResult,
  type NotificationUnarchiveResult,
  type NotificationUpdateResult,
  type NotificationsResult,
  type NotificationsUnreadCountResult,
  type User,
  type UsersResult,
} from "../graphql/documents.ts";
import { fetchAllNodes, fetchNodes } from "../graphql/paginate.ts";
import { getIssue, listLabels, parsePositiveLimit, resolveTeam } from "./issues.ts";
import { getProject } from "./projects.ts";

export const NOTIFICATION_CHANNELS = ["desktop", "mobile", "email", "slack"] as const;
export const NOTIFICATION_CATEGORIES = [
  "assignments",
  "statusChanges",
  "commentsAndReplies",
  "mentions",
  "reactions",
  "subscriptions",
  "documentChanges",
  "postsAndUpdates",
  "reminders",
  "reviews",
  "appsAndIntegrations",
  "triage",
  "customers",
  "feed",
  "billing",
  "system",
] as const;

export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export interface NotificationListOptions {
  limit?: number;
  includeArchived?: boolean;
  type?: string;
  unread?: boolean;
  debug?: boolean;
}

export interface NotificationEntityRefs {
  id?: string;
  issue?: string;
  project?: string;
  initiative?: string;
  projectUpdate?: string;
  initiativeUpdate?: string;
  oauthClientApproval?: string;
}

export interface NotificationMutationOptions extends NotificationEntityRefs {
  apply?: boolean;
  debug?: boolean;
  readAt?: string;
  until?: string;
  at?: string;
}

export interface NotificationUpdateOptions {
  apply?: boolean;
  debug?: boolean;
  readAt?: string;
  unread?: boolean;
  snoozeUntil?: string;
  clearSnooze?: boolean;
}

export interface NotificationSubscriptionCreateOptions {
  team?: string;
  project?: string;
  cycle?: string;
  label?: string;
  initiative?: string;
  customer?: string;
  customView?: string;
  user?: string;
  type?: string[];
  active?: boolean;
  apply?: boolean;
  debug?: boolean;
}

export interface NotificationSubscriptionUpdateOptions {
  type?: string[];
  active?: boolean;
  apply?: boolean;
  debug?: boolean;
}

export interface CategoryChannelOptions {
  channel: string;
  category: string;
  subscribe?: boolean;
  unsubscribe?: boolean;
  apply?: boolean;
  debug?: boolean;
}

async function credentialOptions(debug?: boolean) {
  return { credential: await resolveCredential(), debug };
}

function nowIso(): string {
  return new Date().toISOString();
}

function parseIsoTimestamp(value: string, flag: string): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new ConfigError(`${flag} must be a valid ISO-8601 timestamp.`);
  }
  return new Date(parsed).toISOString();
}

function linkedSummary(notification: Notification): string {
  if (notification.issue) return notification.issue.identifier;
  if (notification.project) return notification.project.name;
  if (notification.initiative) return notification.initiative.name;
  if (notification.pullRequest) return `PR #${notification.pullRequest.number}`;
  if (notification.documentId) return notification.documentId;
  return "";
}

function subscriptionTarget(subscription: NotificationSubscription): string {
  if (subscription.team) return `team:${subscription.team.key}`;
  if (subscription.project) return `project:${subscription.project.name}`;
  if (subscription.cycle) {
    return `cycle:${subscription.cycle.name ?? subscription.cycle.number}`;
  }
  if (subscription.label) return `label:${subscription.label.name}`;
  if (subscription.initiative) return `initiative:${subscription.initiative.name}`;
  if (subscription.customer) return `customer:${subscription.customer.name}`;
  if (subscription.customView) return `customView:${subscription.customView.name}`;
  if (subscription.user) return `user:${subscription.user.email || subscription.user.name}`;
  return "(unknown)";
}

export function formatNotification(notification: Notification): string {
  const lines = [
    `${notification.type}  ${notification.category}`,
    `id: ${notification.id}`,
    `title: ${notification.title}`,
    `subtitle: ${notification.subtitle}`,
    `readAt: ${notification.readAt ?? "(unread)"}`,
    `snoozedUntilAt: ${notification.snoozedUntilAt ?? "(none)"}`,
    `actor: ${notification.actor?.name ?? "(none)"}`,
    `linked: ${linkedSummary(notification) || "(none)"}`,
    `url: ${notification.url}`,
    `createdAt: ${notification.createdAt}`,
  ];
  return lines.join("\n");
}

export function formatNotificationsList(notifications: Notification[]): {
  rows: Record<string, unknown>[];
  columns: string[];
} {
  const rows = notifications.map((n) => ({
    id: n.id,
    type: n.type,
    category: n.category,
    title: n.title,
    read: n.readAt ? "yes" : "no",
    linked: linkedSummary(n),
    createdAt: n.createdAt,
  }));
  return {
    rows,
    columns: ["id", "type", "category", "title", "read", "linked", "createdAt"],
  };
}

export function formatSubscription(subscription: NotificationSubscription): string {
  return [
    `id: ${subscription.id}`,
    `active: ${subscription.active}`,
    `target: ${subscriptionTarget(subscription)}`,
    `types: ${(subscription.notificationSubscriptionTypes ?? []).join(", ") || "(default)"}`,
    `subscriber: ${subscription.subscriber.email || subscription.subscriber.name}`,
    `createdAt: ${subscription.createdAt}`,
  ].join("\n");
}

export function formatSubscriptionsList(subscriptions: NotificationSubscription[]): {
  rows: Record<string, unknown>[];
  columns: string[];
} {
  const rows = subscriptions.map((s) => ({
    id: s.id,
    active: s.active,
    target: subscriptionTarget(s),
    types: (s.notificationSubscriptionTypes ?? []).join(","),
    subscriber: s.subscriber.email || s.subscriber.name,
  }));
  return {
    rows,
    columns: ["id", "active", "target", "types", "subscriber"],
  };
}

export async function listNotifications(
  options: NotificationListOptions = {},
): Promise<Notification[]> {
  const limit = parsePositiveLimit(options.limit);
  const filter: Record<string, unknown> = {};
  if (options.type) {
    filter.type = { eq: options.type };
  }

  // When filtering unread client-side, over-fetch a bit then trim.
  const fetchLimit = options.unread && limit !== undefined ? Math.max(limit * 4, 50) : limit;

  const notifications = await fetchNodes<Notification, NotificationsResult>(
    NOTIFICATIONS_QUERY,
    (data) => data.notifications,
    await credentialOptions(options.debug),
    {
      filter: Object.keys(filter).length ? filter : undefined,
      includeArchived: options.includeArchived ?? false,
      orderBy: "createdAt",
    },
    { limit: fetchLimit },
  );

  const filtered = options.unread
    ? notifications.filter((notification) => notification.readAt == null)
    : notifications;
  return limit === undefined ? filtered : filtered.slice(0, limit);
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

export async function resolveNotificationEntityInput(
  refs: NotificationEntityRefs,
  options: { debug?: boolean } = {},
): Promise<Record<string, string>> {
  const selected = [
    refs.id ? "id" : null,
    refs.issue ? "issue" : null,
    refs.project ? "project" : null,
    refs.initiative ? "initiative" : null,
    refs.projectUpdate ? "projectUpdate" : null,
    refs.initiativeUpdate ? "initiativeUpdate" : null,
    refs.oauthClientApproval ? "oauthClientApproval" : null,
  ].filter(Boolean);

  if (selected.length === 0) {
    throw new ConfigError(
      "Provide exactly one of --id, --issue, --project, --initiative, --project-update, --initiative-update, or --oauth-client-approval.",
    );
  }
  if (selected.length > 1) {
    throw new ConfigError(
      "Provide only one entity selector (--id, --issue, --project, --initiative, --project-update, --initiative-update, or --oauth-client-approval).",
    );
  }

  if (refs.id) return { id: refs.id };
  if (refs.issue) {
    const issue = await getIssue(refs.issue, { debug: options.debug });
    return { issueId: issue.id };
  }
  if (refs.project) {
    const project = await getProject(refs.project, { debug: options.debug });
    return { projectId: project.id };
  }
  if (refs.initiative) return { initiativeId: refs.initiative };
  if (refs.projectUpdate) return { projectUpdateId: refs.projectUpdate };
  if (refs.initiativeUpdate) return { initiativeUpdateId: refs.initiativeUpdate };
  if (!refs.oauthClientApproval) {
    throw new ConfigError(
      "Provide exactly one of --id, --issue, --project, --initiative, --project-update, --initiative-update, or --oauth-client-approval.",
    );
  }
  return { oauthClientApprovalId: refs.oauthClientApproval };
}

export async function updateNotification(
  id: string,
  options: NotificationUpdateOptions,
): Promise<{
  applied: boolean;
  id: string;
  input: Record<string, unknown>;
  notification?: Notification;
}> {
  if (!id.trim()) throw new ConfigError("A notification ID is required.");
  if (options.readAt && options.unread) {
    throw new ConfigError("Use either --read-at or --unread, not both.");
  }
  if (options.snoozeUntil && options.clearSnooze) {
    throw new ConfigError("Use either --snooze-until or --clear-snooze, not both.");
  }

  const input: Record<string, unknown> = {};
  if (options.unread) input.readAt = null;
  if (options.readAt) input.readAt = parseIsoTimestamp(options.readAt, "--read-at");
  if (options.snoozeUntil) {
    input.snoozedUntilAt = parseIsoTimestamp(options.snoozeUntil, "--snooze-until");
  }
  if (options.clearSnooze) input.snoozedUntilAt = null;

  if (Object.keys(input).length === 0) {
    throw new ConfigError(
      "Provide at least one of --read-at, --unread, --snooze-until, or --clear-snooze.",
    );
  }

  if (!options.apply) {
    return { applied: false, id, input };
  }

  const result = await executeGraphql<NotificationUpdateResult>(
    NOTIFICATION_UPDATE,
    { id, input },
    await credentialOptions(options.debug),
  );
  if (!result.notificationUpdate.success) {
    throw new ConfigError("Linear reported the notification was not updated.");
  }
  return {
    applied: true,
    id,
    input,
    notification: result.notificationUpdate.notification,
  };
}

async function runEntityBatchMutation(
  operation: "mark-read" | "mark-unread" | "snooze" | "unsnooze" | "archive-all",
  options: NotificationMutationOptions,
): Promise<{
  applied: boolean;
  operation: string;
  input: Record<string, unknown>;
  notifications?: Notification[];
}> {
  const entityInput = await resolveNotificationEntityInput(options, options);
  const variables: Record<string, unknown> = { input: entityInput };
  let query = NOTIFICATION_MARK_UNREAD_ALL;
  let resultKey = "notificationMarkUnreadAll";

  if (operation === "mark-read") {
    variables.readAt = options.readAt ? parseIsoTimestamp(options.readAt, "--read-at") : nowIso();
    query = NOTIFICATION_MARK_READ_ALL;
    resultKey = "notificationMarkReadAll";
  } else if (operation === "snooze") {
    if (!options.until) throw new ConfigError("--until is required for snooze.");
    variables.snoozedUntilAt = parseIsoTimestamp(options.until, "--until");
    query = NOTIFICATION_SNOOZE_ALL;
    resultKey = "notificationSnoozeAll";
  } else if (operation === "unsnooze") {
    variables.unsnoozedAt = options.at ? parseIsoTimestamp(options.at, "--at") : nowIso();
    query = NOTIFICATION_UNSNOOZE_ALL;
    resultKey = "notificationUnsnoozeAll";
  } else if (operation === "archive-all") {
    query = NOTIFICATION_ARCHIVE_ALL;
    resultKey = "notificationArchiveAll";
  }

  const plannedInput = { ...variables };

  if (!options.apply) {
    return { applied: false, operation, input: plannedInput };
  }

  const result = await executeGraphql<Record<string, unknown>>(
    query,
    variables,
    await credentialOptions(options.debug),
  );

  const payload = result[resultKey] as
    | { success: boolean; notifications: Notification[] }
    | undefined;
  if (!payload?.success) {
    throw new ConfigError(`Linear reported notification ${operation} failed.`);
  }
  return {
    applied: true,
    operation,
    input: plannedInput,
    notifications: payload.notifications,
  };
}

export async function markNotificationsRead(options: NotificationMutationOptions) {
  return runEntityBatchMutation("mark-read", options);
}

export async function markNotificationsUnread(options: NotificationMutationOptions) {
  return runEntityBatchMutation("mark-unread", options);
}

export async function snoozeNotifications(options: NotificationMutationOptions) {
  return runEntityBatchMutation("snooze", options);
}

export async function unsnoozeNotifications(options: NotificationMutationOptions) {
  return runEntityBatchMutation("unsnooze", options);
}

export async function archiveNotificationsAll(options: NotificationMutationOptions) {
  return runEntityBatchMutation("archive-all", options);
}

export async function archiveNotification(
  id: string,
  options: { apply?: boolean; debug?: boolean },
): Promise<{ applied: boolean; id: string; notification?: Notification | null }> {
  if (!id.trim()) throw new ConfigError("A notification ID is required.");
  if (!options.apply) {
    await getNotification(id, options);
    return { applied: false, id };
  }
  const result = await executeGraphql<NotificationArchiveResult>(
    NOTIFICATION_ARCHIVE,
    { id },
    await credentialOptions(options.debug),
  );
  if (!result.notificationArchive.success) {
    throw new ConfigError("Linear reported the notification was not archived.");
  }
  return { applied: true, id, notification: result.notificationArchive.entity };
}

export async function unarchiveNotification(
  id: string,
  options: { apply?: boolean; debug?: boolean },
): Promise<{ applied: boolean; id: string; notification?: Notification | null }> {
  if (!id.trim()) throw new ConfigError("A notification ID is required.");
  if (!options.apply) {
    await getNotification(id, options);
    return { applied: false, id };
  }
  const result = await executeGraphql<NotificationUnarchiveResult>(
    NOTIFICATION_UNARCHIVE,
    { id },
    await credentialOptions(options.debug),
  );
  if (!result.notificationUnarchive.success) {
    throw new ConfigError("Linear reported the notification was not unarchived.");
  }
  return { applied: true, id, notification: result.notificationUnarchive.entity };
}

export async function listNotificationSubscriptions(
  options: { limit?: number; includeArchived?: boolean; debug?: boolean } = {},
): Promise<NotificationSubscription[]> {
  const limit = parsePositiveLimit(options.limit);
  return fetchNodes<NotificationSubscription, NotificationSubscriptionsResult>(
    NOTIFICATION_SUBSCRIPTIONS_QUERY,
    (data) => data.notificationSubscriptions,
    await credentialOptions(options.debug),
    {
      includeArchived: options.includeArchived ?? false,
      orderBy: "createdAt",
    },
    { limit },
  );
}

export async function getNotificationSubscription(
  id: string,
  options: { debug?: boolean } = {},
): Promise<NotificationSubscription> {
  if (!id.trim()) throw new ConfigError("A notification subscription ID is required.");
  const data = await executeGraphql<NotificationSubscriptionResult>(
    NOTIFICATION_SUBSCRIPTION_QUERY,
    { id },
    await credentialOptions(options.debug),
  );
  if (!data.notificationSubscription) {
    throw new ConfigError(`No notification subscription found with ID: ${id}`);
  }
  return data.notificationSubscription;
}

async function resolveLabelIdForSubscription(labelRef: string, debug?: boolean): Promise<string> {
  if (/^[0-9a-f-]{20,}$/i.test(labelRef)) return labelRef;
  const labels = await listLabels({ includeWorkspace: true, debug });
  const normalized = labelRef.toLowerCase();
  const matches = labels.filter(
    (label) => label.id === labelRef || label.name.toLowerCase() === normalized,
  );
  if (matches.length === 0) throw new ConfigError(`No label found for: ${labelRef}`);
  if (matches.length > 1) {
    throw new ConfigError(`Label reference is ambiguous: ${labelRef}. Pass a label ID instead.`);
  }
  const label = matches[0];
  if (!label) throw new ConfigError(`No label found for: ${labelRef}`);
  return label.id;
}

async function resolveUserIdForSubscription(userRefRaw: string, debug?: boolean): Promise<string> {
  const userRef = userRefRaw.trim();
  if (userRef.toLowerCase() === "me") {
    const current = await executeGraphql<{ viewer: User }>(
      "query ViewerUser { viewer { id name email active admin archivedAt } }",
      {},
      await credentialOptions(debug),
    );
    return current.viewer.id;
  }
  const users = await fetchAllNodes<User, UsersResult>(
    USERS_QUERY,
    (data) => data.users,
    await credentialOptions(debug),
    { includeArchived: false },
  );
  const normalized = userRef.toLowerCase();
  const matches = users.filter(
    (user) =>
      user.id === userRef ||
      user.email.toLowerCase() === normalized ||
      user.name.toLowerCase() === normalized,
  );
  if (matches.length === 0) throw new ConfigError(`No user found for: ${userRef}`);
  if (matches.length > 1) throw new ConfigError(`User reference is ambiguous: ${userRef}`);
  const user = matches[0];
  if (!user) throw new ConfigError(`No user found for: ${userRef}`);
  return user.id;
}

async function resolveSubscriptionCreateInput(
  options: NotificationSubscriptionCreateOptions,
): Promise<Record<string, unknown>> {
  const targets = [
    options.team ? "team" : null,
    options.project ? "project" : null,
    options.cycle ? "cycle" : null,
    options.label ? "label" : null,
    options.initiative ? "initiative" : null,
    options.customer ? "customer" : null,
    options.customView ? "customView" : null,
    options.user ? "user" : null,
  ].filter(Boolean);

  if (targets.length === 0) {
    throw new ConfigError(
      "Provide exactly one of --team, --project, --cycle, --label, --initiative, --customer, --custom-view, or --user.",
    );
  }
  if (targets.length > 1) {
    throw new ConfigError("Provide only one subscription target selector.");
  }

  const input: Record<string, unknown> = {};
  if (options.type?.length) input.notificationSubscriptionTypes = options.type;
  if (options.active !== undefined) input.active = options.active;

  if (options.team) {
    input.teamId = (await resolveTeam(options.team, { debug: options.debug })).id;
    return input;
  }
  if (options.project) {
    input.projectId = (await getProject(options.project, { debug: options.debug })).id;
    return input;
  }
  if (options.cycle) {
    if (!/^[0-9a-f-]{20,}$/i.test(options.cycle)) {
      throw new ConfigError(
        "Cycle subscriptions require a cycle ID (use `linear cycle list --team ...` to discover IDs).",
      );
    }
    input.cycleId = options.cycle;
    return input;
  }
  if (options.label) {
    input.labelId = await resolveLabelIdForSubscription(options.label, options.debug);
    return input;
  }
  if (options.initiative) {
    input.initiativeId = options.initiative;
    return input;
  }
  if (options.customer) {
    input.customerId = options.customer;
    return input;
  }
  if (options.customView) {
    input.customViewId = options.customView;
    return input;
  }
  if (!options.user) {
    throw new ConfigError(
      "Provide exactly one of --team, --project, --cycle, --label, --initiative, --customer, --custom-view, or --user.",
    );
  }
  input.userId = await resolveUserIdForSubscription(options.user, options.debug);
  return input;
}

export async function createNotificationSubscription(
  options: NotificationSubscriptionCreateOptions,
): Promise<{
  applied: boolean;
  input: Record<string, unknown>;
  subscription?: NotificationSubscription;
}> {
  const input = await resolveSubscriptionCreateInput(options);
  if (!options.apply) {
    return { applied: false, input };
  }
  const result = await executeGraphql<NotificationSubscriptionCreateResult>(
    NOTIFICATION_SUBSCRIPTION_CREATE,
    { input },
    await credentialOptions(options.debug),
  );
  if (!result.notificationSubscriptionCreate.success) {
    throw new ConfigError("Linear reported the notification subscription was not created.");
  }
  return {
    applied: true,
    input,
    subscription: result.notificationSubscriptionCreate.notificationSubscription,
  };
}

export async function updateNotificationSubscription(
  id: string,
  options: NotificationSubscriptionUpdateOptions,
): Promise<{
  applied: boolean;
  id: string;
  input: Record<string, unknown>;
  subscription?: NotificationSubscription;
}> {
  if (!id.trim()) throw new ConfigError("A notification subscription ID is required.");
  const input: Record<string, unknown> = {};
  if (options.type?.length) input.notificationSubscriptionTypes = options.type;
  if (options.active !== undefined) input.active = options.active;
  if (Object.keys(input).length === 0) {
    throw new ConfigError("Provide at least one of --type, --active, or --inactive.");
  }

  if (!options.apply) {
    await getNotificationSubscription(id, options);
    return { applied: false, id, input };
  }

  const result = await executeGraphql<NotificationSubscriptionUpdateResult>(
    NOTIFICATION_SUBSCRIPTION_UPDATE,
    { id, input },
    await credentialOptions(options.debug),
  );
  if (!result.notificationSubscriptionUpdate.success) {
    throw new ConfigError("Linear reported the notification subscription was not updated.");
  }
  return {
    applied: true,
    id,
    input,
    subscription: result.notificationSubscriptionUpdate.notificationSubscription,
  };
}

export async function setCategoryChannelSubscription(options: CategoryChannelOptions): Promise<{
  applied: boolean;
  channel: NotificationChannel;
  category: NotificationCategory;
  subscribe: boolean;
}> {
  const channel = options.channel.toLowerCase();
  const category = options.category;
  if (!NOTIFICATION_CHANNELS.includes(channel as NotificationChannel)) {
    throw new ConfigError(`--channel must be one of ${NOTIFICATION_CHANNELS.join(", ")}.`);
  }
  if (!NOTIFICATION_CATEGORIES.includes(category as NotificationCategory)) {
    throw new ConfigError(`--category must be one of ${NOTIFICATION_CATEGORIES.join(", ")}.`);
  }
  if (options.subscribe && options.unsubscribe) {
    throw new ConfigError("Use either --subscribe or --unsubscribe, not both.");
  }
  if (!options.subscribe && !options.unsubscribe) {
    throw new ConfigError("Provide --subscribe or --unsubscribe.");
  }
  const subscribe = Boolean(options.subscribe);

  if (!options.apply) {
    return {
      applied: false,
      channel: channel as NotificationChannel,
      category: category as NotificationCategory,
      subscribe,
    };
  }

  const result = await executeGraphql<NotificationCategoryChannelUpdateResult>(
    NOTIFICATION_CATEGORY_CHANNEL_UPDATE,
    { channel, category, subscribe },
    await credentialOptions(options.debug),
  );
  if (!result.notificationCategoryChannelSubscriptionUpdate.success) {
    throw new ConfigError("Linear reported the category/channel preference was not updated.");
  }
  return {
    applied: true,
    channel: channel as NotificationChannel,
    category: category as NotificationCategory,
    subscribe,
  };
}
