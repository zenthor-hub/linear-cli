import { ConfigError } from "../../errors.ts";
import { executeGraphql } from "../../graphql/client.ts";
import {
  NOTIFICATION_ARCHIVE,
  NOTIFICATION_ARCHIVE_ALL,
  NOTIFICATION_MARK_READ_ALL,
  NOTIFICATION_MARK_UNREAD_ALL,
  NOTIFICATION_SNOOZE_ALL,
  NOTIFICATION_UNARCHIVE,
  NOTIFICATION_UNSNOOZE_ALL,
  NOTIFICATION_UPDATE,
  type Notification,
  type NotificationArchiveResult,
  type NotificationUnarchiveResult,
  type NotificationUpdateResult,
} from "../../graphql/documents.ts";
import { getIssue } from "../issues.ts";
import { getProject } from "../projects.ts";
import { credentialOptions, nowIso, parseIsoTimestamp, requireExactlyOne } from "./helpers.ts";
import { getNotification } from "./list.ts";

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
  /** Mark read at now (shortcut for agents). */
  read?: boolean;
  readAt?: string;
  unread?: boolean;
  snoozeUntil?: string;
  clearSnooze?: boolean;
}

export async function resolveNotificationEntityInput(
  refs: NotificationEntityRefs,
  options: { debug?: boolean } = {},
): Promise<Record<string, string>> {
  const { key, value } = requireExactlyOne(
    {
      id: refs.id,
      issue: refs.issue,
      project: refs.project,
      initiative: refs.initiative,
      projectUpdate: refs.projectUpdate,
      initiativeUpdate: refs.initiativeUpdate,
      oauthClientApproval: refs.oauthClientApproval,
    },
    "Provide exactly one of --id, --issue, --project, --initiative, --project-update, --initiative-update, or --oauth-client-approval.",
    "Provide only one entity selector (--id, --issue, --project, --initiative, --project-update, --initiative-update, or --oauth-client-approval).",
  );

  switch (key) {
    case "id":
      return { id: value };
    case "issue": {
      const issue = await getIssue(value, { debug: options.debug });
      return { issueId: issue.id };
    }
    case "project": {
      const project = await getProject(value, { debug: options.debug });
      return { projectId: project.id };
    }
    case "initiative":
      return { initiativeId: value };
    case "projectUpdate":
      return { projectUpdateId: value };
    case "initiativeUpdate":
      return { initiativeUpdateId: value };
    case "oauthClientApproval":
      return { oauthClientApprovalId: value };
  }
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

  const readFlags = [options.read, options.readAt, options.unread].filter(Boolean).length;
  if (readFlags > 1) {
    throw new ConfigError("Use only one of --read, --read-at, or --unread.");
  }
  if (options.snoozeUntil && options.clearSnooze) {
    throw new ConfigError("Use either --snooze-until or --clear-snooze, not both.");
  }

  const input: Record<string, unknown> = {};
  if (options.unread) input.readAt = null;
  if (options.read) input.readAt = nowIso();
  if (options.readAt) input.readAt = parseIsoTimestamp(options.readAt, "--read-at");
  if (options.snoozeUntil) {
    input.snoozedUntilAt = parseIsoTimestamp(options.snoozeUntil, "--snooze-until");
  }
  if (options.clearSnooze) input.snoozedUntilAt = null;

  if (Object.keys(input).length === 0) {
    throw new ConfigError(
      "Provide at least one of --read, --read-at, --unread, --snooze-until, or --clear-snooze.",
    );
  }

  if (!options.apply) {
    await getNotification(id, options);
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
