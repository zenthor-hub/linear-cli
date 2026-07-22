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

export const NOTIFICATION_SUBSCRIPTION_TYPES = [
  "customer",
  "customView",
  "cycle",
  "label",
  "issue",
  "oauthClientApproval",
  "project",
  "initiative",
  "document",
  "pullRequest",
  "team",
  "user",
] as const;

export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];
export type NotificationSubscriptionType = (typeof NOTIFICATION_SUBSCRIPTION_TYPES)[number];

/** Default `--limit` for `notification list` (matches issue search). */
export const DEFAULT_NOTIFICATION_LIST_LIMIT = 50;

/**
 * Max GraphQL pages when applying client-side filters (`--unread` / `--category`).
 * Each page returns up to 50 nodes, so this caps scans at 5,000 inbox rows.
 */
export const MAX_CLIENT_FILTER_PAGES = 100;

/** Max characters of linked comment body shown in human `get`/`update` output. */
export const NOTIFICATION_COMMENT_PREVIEW_CHARS = 280;
