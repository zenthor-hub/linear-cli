import type {
  Notification,
  NotificationChannelPreferenceFlags,
  NotificationSubscription,
} from "../../graphql/documents.ts";
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_COMMENT_PREVIEW_CHARS,
  type NotificationCategory,
} from "./constants.ts";
import { singleLine, truncateForDisplay } from "./helpers.ts";

export interface NotificationPreferences {
  channelPreferences: NotificationChannelPreferenceFlags;
  categoryPreferences: Array<
    { category: NotificationCategory } & NotificationChannelPreferenceFlags
  >;
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
  if (notification.comment?.body) {
    lines.push(
      `comment: ${truncateForDisplay(singleLine(notification.comment.body), NOTIFICATION_COMMENT_PREVIEW_CHARS)}`,
    );
  }
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

export function formatNotificationPreferences(prefs: NotificationPreferences): {
  rows: Record<string, unknown>[];
  columns: string[];
} {
  const rows = prefs.categoryPreferences.map((row) => {
    const out: Record<string, unknown> = { category: row.category };
    for (const channel of NOTIFICATION_CHANNELS) {
      out[channel] = row[channel] ? "yes" : "no";
    }
    return out;
  });
  return {
    rows,
    columns: ["category", ...NOTIFICATION_CHANNELS],
  };
}
