import type { Command } from "commander";

import {
  archiveNotification,
  archiveNotificationsAll,
  createNotificationSubscription,
  DEFAULT_NOTIFICATION_LIST_LIMIT,
  deleteNotificationSubscription,
  formatNotification,
  formatNotificationPreferences,
  formatNotificationsList,
  formatSubscription,
  formatSubscriptionsList,
  getNotification,
  getNotificationPreferences,
  getNotificationSubscription,
  getUnreadCount,
  listNotificationSubscriptions,
  listNotifications,
  markNotificationsRead,
  markNotificationsUnread,
  NOTIFICATION_CHANNELS,
  setCategoryChannelSubscription,
  snoozeNotifications,
  unarchiveNotification,
  unsnoozeNotifications,
  updateNotification,
  updateNotificationSubscription,
} from "../commands/notifications/index.ts";
import { ConfigError } from "../errors.ts";
import type { Notification } from "../graphql/documents.ts";
import { renderTable } from "../output/format.ts";
import { collect, globals, run } from "./shared.ts";

function entitySelectorOptions(command: Command): Command {
  return command
    .option("--id <notificationId>", "notification ID (entity input id)")
    .option("--issue <issue>", "issue identifier or UUID")
    .option("--project <project>", "project name or ID")
    .option("--initiative <id>", "initiative ID")
    .option("--project-update <id>", "project update ID")
    .option("--initiative-update <id>", "initiative update ID")
    .option("--oauth-client-approval <id>", "OAuth client approval ID");
}

function dryRunMutationMessage(
  label: string,
  data: { applied: boolean; input?: unknown; notifications?: Notification[] },
): string {
  if (!data.applied) {
    return `Dry run: would ${label}.\nInput:\n${JSON.stringify(data.input ?? data, null, 2)}\nRe-run with --apply to execute.`;
  }
  const notifications = data.notifications ?? [];
  if (notifications.length === 0) {
    return `${label} succeeded (0 notifications).`;
  }
  const { rows, columns } = formatNotificationsList(notifications);
  return `${label} succeeded (${notifications.length}).\n${renderTable(rows, columns)}`;
}

function renderNotificationList(data: Notification[], effectiveLimit: number): string {
  const { rows, columns } = formatNotificationsList(data);
  const truncationNote =
    data.length === effectiveLimit
      ? `\n(showing ${effectiveLimit}; more may exist — raise --limit to see them)`
      : "";
  return `${renderTable(rows, columns)}${truncationNote}`;
}

type EntityOpts = {
  id?: string;
  issue?: string;
  project?: string;
  initiative?: string;
  projectUpdate?: string;
  initiativeUpdate?: string;
  oauthClientApproval?: string;
  apply?: boolean;
};

function addInboxReadCommands(notification: Command): void {
  notification
    .command("list")
    .description("List inbox notifications")
    .option("--limit <n>", "max notifications to return (default 50)", (v) => Number(v))
    .option("--include-archived", "include archived notifications")
    .option("--type <type>", "filter by notification type (repeatable)", collect, [])
    .option(
      "--subscription-type <type>",
      "filter by subscription type (repeatable; e.g. issue, pullRequest)",
      collect,
      [],
    )
    .option("--category <category>", "client-side filter by notification category")
    .option("--since <iso>", "only notifications created at/after this timestamp")
    .option("--before <iso>", "only notifications created at/before this timestamp")
    .option(
      "--unread",
      "client-side filter to unread notifications (readAt is null; pages until filled)",
    )
    .action(async function (
      this: Command,
      opts: {
        limit?: number;
        includeArchived?: boolean;
        type?: string[];
        subscriptionType?: string[];
        category?: string;
        since?: string;
        before?: string;
        unread?: boolean;
      },
    ) {
      const g = globals(this);
      await run(
        "notification.list",
        g,
        () =>
          listNotifications({
            limit: opts.limit,
            includeArchived: opts.includeArchived,
            type: opts.type?.length ? opts.type : undefined,
            subscriptionType: opts.subscriptionType?.length ? opts.subscriptionType : undefined,
            category: opts.category,
            since: opts.since,
            before: opts.before,
            unread: opts.unread,
            debug: g.debug,
          }),
        (data) => renderNotificationList(data, opts.limit ?? DEFAULT_NOTIFICATION_LIST_LIMIT),
      );
    });

  notification
    .command("get")
    .description("Get a notification by ID")
    .argument("<id>", "notification ID")
    .action(async function (this: Command, id: string) {
      const g = globals(this);
      await run(
        "notification.get",
        g,
        () => getNotification(id, { debug: g.debug }),
        formatNotification,
      );
    });

  notification
    .command("unread-count")
    .description("Get the unread notifications count")
    .action(async function (this: Command) {
      const g = globals(this);
      await run(
        "notification.unread-count",
        g,
        () => getUnreadCount({ debug: g.debug }),
        (count) => `Unread notifications: ${count}`,
      );
    });

  notification
    .command("update")
    .description("Update a notification (dry-run unless --apply)")
    .argument("<id>", "notification ID")
    .option("--read", "mark as read now")
    .option("--read-at <iso>", "mark read at timestamp")
    .option("--unread", "mark as unread (clears readAt)")
    .option("--snooze-until <iso>", "snooze until timestamp")
    .option("--clear-snooze", "clear snooze")
    .option("--apply", "execute the update (dry-run by default)")
    .action(async function (
      this: Command,
      id: string,
      opts: {
        read?: boolean;
        readAt?: string;
        unread?: boolean;
        snoozeUntil?: string;
        clearSnooze?: boolean;
        apply?: boolean;
      },
    ) {
      const g = globals(this);
      await run(
        "notification.update",
        g,
        () => updateNotification(id, { ...opts, debug: g.debug }),
        (data) => {
          if (!data.applied) {
            return `Dry run: would update notification ${data.id} with input:\n${JSON.stringify(data.input, null, 2)}\nRe-run with --apply to execute.`;
          }
          if (!data.notification) {
            throw new ConfigError(`Notification update returned no notification for ${data.id}`);
          }
          return formatNotification(data.notification);
        },
      );
    });
}

function addInboxBatchCommands(notification: Command): void {
  entitySelectorOptions(
    notification
      .command("mark-read")
      .description("Mark notification(s) for an entity as read (dry-run unless --apply)")
      .option("--read-at <iso>", "read timestamp (defaults to now)")
      .option("--apply", "execute the mutation (dry-run by default)"),
  ).action(async function (this: Command, opts: EntityOpts & { readAt?: string }) {
    const g = globals(this);
    await run(
      "notification.mark-read",
      g,
      () => markNotificationsRead({ ...opts, debug: g.debug }),
      (data) => dryRunMutationMessage("mark notifications read", data),
    );
  });

  entitySelectorOptions(
    notification
      .command("mark-unread")
      .description("Mark notification(s) for an entity as unread (dry-run unless --apply)")
      .option("--apply", "execute the mutation (dry-run by default)"),
  ).action(async function (this: Command, opts: EntityOpts) {
    const g = globals(this);
    await run(
      "notification.mark-unread",
      g,
      () => markNotificationsUnread({ ...opts, debug: g.debug }),
      (data) => dryRunMutationMessage("mark notifications unread", data),
    );
  });

  entitySelectorOptions(
    notification
      .command("snooze")
      .description("Snooze notification(s) for an entity (dry-run unless --apply)")
      .requiredOption("--until <iso>", "snooze until timestamp")
      .option("--apply", "execute the mutation (dry-run by default)"),
  ).action(async function (this: Command, opts: EntityOpts & { until: string }) {
    const g = globals(this);
    await run(
      "notification.snooze",
      g,
      () => snoozeNotifications({ ...opts, debug: g.debug }),
      (data) => dryRunMutationMessage("snooze notifications", data),
    );
  });

  entitySelectorOptions(
    notification
      .command("unsnooze")
      .description("Unsnooze notification(s) for an entity (dry-run unless --apply)")
      .option("--at <iso>", "unsnooze timestamp (defaults to now)")
      .option("--apply", "execute the mutation (dry-run by default)"),
  ).action(async function (this: Command, opts: EntityOpts & { at?: string }) {
    const g = globals(this);
    await run(
      "notification.unsnooze",
      g,
      () => unsnoozeNotifications({ ...opts, debug: g.debug }),
      (data) => dryRunMutationMessage("unsnooze notifications", data),
    );
  });

  notification
    .command("archive")
    .description("Archive a notification (dry-run unless --apply)")
    .argument("<id>", "notification ID")
    .option("--apply", "execute the archive (dry-run by default)")
    .action(async function (this: Command, id: string, opts: { apply?: boolean }) {
      const g = globals(this);
      await run(
        "notification.archive",
        g,
        () => archiveNotification(id, { ...opts, debug: g.debug }),
        (data) => {
          if (!data.applied) {
            return `Dry run: would archive notification ${data.id}.\nRe-run with --apply to execute.`;
          }
          return data.notification ? formatNotification(data.notification) : `Archived ${data.id}`;
        },
      );
    });

  entitySelectorOptions(
    notification
      .command("archive-all")
      .description("Archive notification(s) for an entity (dry-run unless --apply)")
      .option("--apply", "execute the mutation (dry-run by default)"),
  ).action(async function (this: Command, opts: EntityOpts) {
    const g = globals(this);
    await run(
      "notification.archive-all",
      g,
      () => archiveNotificationsAll({ ...opts, debug: g.debug }),
      (data) => dryRunMutationMessage("archive notifications", data),
    );
  });

  notification
    .command("unarchive")
    .description("Unarchive a notification (dry-run unless --apply)")
    .argument("<id>", "notification ID")
    .option("--apply", "execute the unarchive (dry-run by default)")
    .action(async function (this: Command, id: string, opts: { apply?: boolean }) {
      const g = globals(this);
      await run(
        "notification.unarchive",
        g,
        () => unarchiveNotification(id, { ...opts, debug: g.debug }),
        (data) => {
          if (!data.applied) {
            return `Dry run: would unarchive notification ${data.id}.\nRe-run with --apply to execute.`;
          }
          return data.notification
            ? formatNotification(data.notification)
            : `Unarchived ${data.id}`;
        },
      );
    });
}

function addSubscriptionReadCommands(subscription: Command): void {
  subscription
    .command("list")
    .description("List notification subscriptions")
    .option("--limit <n>", "max subscriptions to return", (v) => Number(v))
    .option("--include-archived", "include archived subscriptions")
    .action(async function (this: Command, opts: { limit?: number; includeArchived?: boolean }) {
      const g = globals(this);
      await run(
        "notification.subscription.list",
        g,
        () => listNotificationSubscriptions({ ...opts, debug: g.debug }),
        (data) => {
          const { rows, columns } = formatSubscriptionsList(data);
          return renderTable(rows, columns);
        },
      );
    });

  subscription
    .command("get")
    .description("Get a notification subscription by ID")
    .argument("<id>", "subscription ID")
    .action(async function (this: Command, id: string) {
      const g = globals(this);
      await run(
        "notification.subscription.get",
        g,
        () => getNotificationSubscription(id, { debug: g.debug }),
        formatSubscription,
      );
    });
}

function rejectActiveInactiveConflict(opts: { active?: boolean; inactive?: boolean }): void {
  if (opts.active && opts.inactive) {
    throw new ConfigError("Use either --active or --inactive, not both.");
  }
}

function addSubscriptionCreateCommand(subscription: Command): void {
  subscription
    .command("create")
    .description("Create a notification subscription (dry-run unless --apply)")
    .option("--team <team>", "team key, name, or ID")
    .option("--project <project>", "project name or ID")
    .option("--cycle <id>", "cycle ID")
    .option("--label <label>", "label name or ID")
    .option("--initiative <id>", "initiative ID")
    .option("--customer <id>", "customer ID")
    .option("--custom-view <id>", "custom view ID")
    .option("--user <user>", "user email, name, ID, or me")
    .option(
      "--type <type>",
      "notification event type to subscribe to (repeatable; e.g. issueCommentMention); omit to receive all types",
      collect,
      [],
    )
    .option("--active", "create as active")
    .option("--inactive", "create as inactive")
    .option("--apply", "execute the create (dry-run by default)")
    .action(async function (
      this: Command,
      opts: {
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
        inactive?: boolean;
        apply?: boolean;
      },
    ) {
      const g = globals(this);
      rejectActiveInactiveConflict(opts);
      await run(
        "notification.subscription.create",
        g,
        () =>
          createNotificationSubscription({
            ...opts,
            type: opts.type?.length ? opts.type : undefined,
            active: opts.inactive ? false : opts.active,
            debug: g.debug,
          }),
        (data) => {
          if (!data.applied) {
            return `Dry run: would create notification subscription with input:\n${JSON.stringify(data.input, null, 2)}\nRe-run with --apply to execute.`;
          }
          if (!data.subscription) {
            throw new ConfigError("Subscription create returned no subscription.");
          }
          return formatSubscription(data.subscription);
        },
      );
    });
}

function addSubscriptionUpdateDeleteCommands(subscription: Command): void {
  subscription
    .command("update")
    .description("Update a notification subscription (dry-run unless --apply)")
    .argument("<id>", "subscription ID")
    .option(
      "--type <type>",
      "notification event type to subscribe to (repeatable); replaces all previously configured types",
      collect,
      [],
    )
    .option("--active", "set active")
    .option("--inactive", "set inactive")
    .option("--apply", "execute the update (dry-run by default)")
    .action(async function (
      this: Command,
      id: string,
      opts: { type?: string[]; active?: boolean; inactive?: boolean; apply?: boolean },
    ) {
      const g = globals(this);
      rejectActiveInactiveConflict(opts);
      await run(
        "notification.subscription.update",
        g,
        () =>
          updateNotificationSubscription(id, {
            type: opts.type?.length ? opts.type : undefined,
            active: opts.inactive ? false : opts.active,
            apply: opts.apply,
            debug: g.debug,
          }),
        (data) => {
          if (!data.applied) {
            return `Dry run: would update subscription ${data.id} with input:\n${JSON.stringify(data.input, null, 2)}\nRe-run with --apply to execute.`;
          }
          if (!data.subscription) {
            throw new ConfigError(`Subscription update returned no subscription for ${data.id}`);
          }
          return formatSubscription(data.subscription);
        },
      );
    });

  subscription
    .command("delete")
    .description("Delete a notification subscription (dry-run unless --apply)")
    .argument("<id>", "subscription ID")
    .option("--apply", "execute the delete (dry-run by default)")
    .action(async function (this: Command, id: string, opts: { apply?: boolean }) {
      const g = globals(this);
      await run(
        "notification.subscription.delete",
        g,
        () => deleteNotificationSubscription(id, { ...opts, debug: g.debug }),
        (data) => {
          if (!data.applied) {
            return `Dry run: would delete notification subscription ${data.id}.\nRe-run with --apply to execute.`;
          }
          return `Deleted notification subscription ${data.id}`;
        },
      );
    });
}

function addSubscriptionCommands(notification: Command): void {
  const subscription = notification
    .command("subscription")
    .description("Notification subscription management");
  addSubscriptionReadCommands(subscription);
  addSubscriptionCreateCommand(subscription);
  addSubscriptionUpdateDeleteCommands(subscription);
}

function addCategoryChannelCommands(notification: Command): void {
  const categoryChannel = notification
    .command("category-channel")
    .description("Per-channel notification category preferences");

  categoryChannel
    .command("get")
    .description("Show current notification category/channel preferences")
    .action(async function (this: Command) {
      const g = globals(this);
      await run(
        "notification.category-channel.get",
        g,
        () => getNotificationPreferences({ debug: g.debug }),
        (data) => {
          const channel = data.channelPreferences;
          const switches = NOTIFICATION_CHANNELS.map(
            (name) => `${name}=${channel[name] ? "on" : "off"}`,
          ).join(" ");
          const header = [
            "Channel master switches:",
            `  ${switches}`,
            "",
            "Category preferences:",
          ].join("\n");
          const { rows, columns } = formatNotificationPreferences(data);
          return `${header}\n${renderTable(rows, columns)}`;
        },
      );
    });

  categoryChannel
    .command("set")
    .description("Subscribe or unsubscribe a category on a channel (dry-run unless --apply)")
    .requiredOption("--channel <channel>", "desktop, mobile, email, or slack")
    .requiredOption("--category <category>", "notification category (e.g. assignments, mentions)")
    .option("--subscribe", "subscribe to the category on the channel")
    .option("--unsubscribe", "unsubscribe from the category on the channel")
    .option("--apply", "execute the update (dry-run by default)")
    .action(async function (
      this: Command,
      opts: {
        channel: string;
        category: string;
        subscribe?: boolean;
        unsubscribe?: boolean;
        apply?: boolean;
      },
    ) {
      const g = globals(this);
      await run(
        "notification.category-channel.set",
        g,
        () => setCategoryChannelSubscription({ ...opts, debug: g.debug }),
        (data) => {
          const action = data.subscribe ? "subscribe" : "unsubscribe";
          if (!data.applied) {
            return `Dry run: would ${action} category ${data.category} on channel ${data.channel}.\nRe-run with --apply to execute.`;
          }
          return `${action}d category ${data.category} on channel ${data.channel}`;
        },
      );
    });
}

/** Register inbox notification commands on the agent CLI. */
export function addNotificationCommands(program: Command): Command {
  const notification = program.command("notification").description("Inbox notification workflow");
  addInboxReadCommands(notification);
  addInboxBatchCommands(notification);
  addSubscriptionCommands(notification);
  addCategoryChannelCommands(notification);
  return notification;
}
