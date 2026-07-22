#!/usr/bin/env node
import { Command } from "commander";

import { addAuthCommands } from "./cli/auth.ts";
import { addGlobalOptions, collect, globals, run } from "./cli/shared.ts";
import { DEFAULT_LINEAR_SCOPE } from "./commands/auth.ts";
import { formatCyclesList, listCycles } from "./commands/cycles.ts";
import {
  archiveIssue,
  commentOnIssue,
  createIssue,
  createIssueRelation,
  deleteIssueRelation,
  formatCommentsList,
  formatIssue,
  formatIssuesList,
  formatLabelsList,
  formatRelationsList,
  formatStatesList,
  getIssue,
  listIssueComments,
  listIssueRelations,
  listLabels,
  listStates,
  searchIssues,
  unarchiveIssue,
  updateIssue,
} from "./commands/issues.ts";
import {
  archiveNotification,
  archiveNotificationsAll,
  createNotificationSubscription,
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
  setCategoryChannelSubscription,
  snoozeNotifications,
  unarchiveNotification,
  unsnoozeNotifications,
  updateNotification,
  updateNotificationSubscription,
} from "./commands/notifications.ts";
import {
  formatProject,
  formatProjectsList,
  getProject,
  listProjects,
} from "./commands/projects.ts";
import { ConfigError } from "./errors.ts";
import type { Notification } from "./graphql/documents.ts";
import { renderTable } from "./output/format.ts";

const program = new Command();

addGlobalOptions(
  program.name("linear").description("Linear issue workflow CLI for agents and humans."),
);

addAuthCommands(program, { defaultScope: DEFAULT_LINEAR_SCOPE });

const issue = program.command("issue").description("Issue workflow commands");

issue
  .command("get")
  .description("Get an issue by identifier (STU-123) or UUID")
  .argument("<issue>", "issue identifier or UUID")
  .action(async function (this: Command, ref: string) {
    const g = globals(this);
    await run("issue.get", g, () => getIssue(ref, { debug: g.debug }), formatIssue);
  });

issue
  .command("search")
  .description("Search issues with structured filters and/or full-text query")
  .option("--team <team>", "team key, name, or ID")
  .option("--state <state>", "state name/type/ID; requires --team")
  .option("--assignee <user>", "assignee email/name/ID, me, or unassigned")
  .option("--query <term>", "full-text search term (Linear searchIssues)")
  .option("--include-archived", "include archived issues")
  .option("--include-comments", "include comment bodies in full-text search")
  .option("--limit <n>", "max results to return (default 50)", (v) => Number(v))
  .action(async function (
    this: Command,
    opts: {
      team?: string;
      state?: string;
      assignee?: string;
      query?: string;
      includeArchived?: boolean;
      includeComments?: boolean;
      limit?: number;
    },
  ) {
    const g = globals(this);
    await run(
      "issue.search",
      g,
      () => searchIssues({ ...opts, debug: g.debug }),
      (data) => {
        const { rows, columns } = formatIssuesList(data);
        return renderTable(rows, columns);
      },
    );
  });

issue
  .command("update")
  .description("Update an issue (dry-run unless --apply)")
  .argument("<issue>", "issue identifier or UUID")
  .option("--title <title>", "new issue title")
  .option("--description <markdown>", "new markdown description")
  .option("--description-file <file>", "read markdown description from a file")
  .option("--state <state>", "new state name/type/ID")
  .option("--assignee <user>", "assignee email/name/ID, me, or unassigned")
  .option("--priority <priority>", "none, urgent, high, normal, low, or 0-4")
  .option("--parent <issue>", "parent issue identifier/ID, or none to clear")
  .option("--project <project>", "project name/ID, or none to clear")
  .option("--cycle <cycle>", "cycle name/number/ID/active/next, or none to clear")
  .option("--due-date <date>", "due date YYYY-MM-DD, or none to clear")
  .option("--estimate <n>", "estimate points, or none to clear")
  .option("--team <team>", "move issue to another team (key/name/ID)")
  .option("--label <label>", "replace all labels by name/ID (repeatable)", collect, [])
  .option("--add-label <label>", "add label by name/ID (repeatable)", collect, [])
  .option("--remove-label <label>", "remove label by name/ID (repeatable)", collect, [])
  .option("--apply", "execute the update (dry-run by default)")
  .action(async function (
    this: Command,
    ref: string,
    opts: {
      title?: string;
      description?: string;
      descriptionFile?: string;
      state?: string;
      assignee?: string;
      priority?: string;
      parent?: string;
      project?: string;
      cycle?: string;
      dueDate?: string;
      estimate?: string;
      team?: string;
      label: string[];
      addLabel: string[];
      removeLabel: string[];
      apply?: boolean;
    },
  ) {
    const g = globals(this);
    await run(
      "issue.update",
      g,
      () =>
        updateIssue(ref, {
          ...opts,
          label: opts.label,
          addLabel: opts.addLabel,
          removeLabel: opts.removeLabel,
          debug: g.debug,
        }),
      (data) => {
        const changeCount = Object.keys(data.plannedChanges).length;
        if (changeCount === 0) return `No changes for ${data.issue.identifier}.`;
        if (!data.applied) {
          return `Dry run: would update ${data.issue.identifier} with input:\n${JSON.stringify(data.input, null, 2)}\nPlanned changes:\n${JSON.stringify(data.plannedChanges, null, 2)}\nRe-run with --apply to execute.`;
        }
        return `Updated ${data.result?.identifier ?? data.issue.identifier}`;
      },
    );
  });

issue
  .command("comment")
  .description("Comment on an issue (dry-run unless --apply)")
  .argument("<issue>", "issue identifier or UUID")
  .option("--body <markdown>", "comment body")
  .option("--body-file <file>", "read comment body from a file")
  .option("--apply", "create the comment (dry-run by default)")
  .action(async function (
    this: Command,
    ref: string,
    opts: { body?: string; bodyFile?: string; apply?: boolean },
  ) {
    const g = globals(this);
    await run(
      "issue.comment",
      g,
      () => commentOnIssue(ref, { ...opts, debug: g.debug }),
      (data) => {
        if (!data.applied) {
          return `Dry run: would comment on ${data.issue.identifier} with input:\n${JSON.stringify(data.input, null, 2)}\nRe-run with --apply to execute.`;
        }
        return `Commented on ${data.issue.identifier}: ${data.comment?.url}`;
      },
    );
  });

issue
  .command("comments")
  .description("List comments on an issue")
  .argument("<issue>", "issue identifier or UUID")
  .option("--limit <n>", "max comments to return (default 50)", (v) => Number(v))
  .action(async function (this: Command, ref: string, opts: { limit?: number }) {
    const g = globals(this);
    await run(
      "issue.comments",
      g,
      () => listIssueComments(ref, { ...opts, debug: g.debug }),
      (data) => {
        const { rows, columns } = formatCommentsList(data.comments);
        return `${data.issue.identifier} comments (${data.comments.length})\n${renderTable(rows, columns)}`;
      },
    );
  });

issue
  .command("create")
  .description("Create an issue (dry-run unless --apply)")
  .requiredOption("--team <team>", "team key, name, or ID")
  .requiredOption("--title <title>", "issue title")
  .option("--description <markdown>", "markdown description")
  .option("--description-file <file>", "read markdown description from a file")
  .option("--state <state>", "state name/type/ID")
  .option("--assignee <user>", "assignee email/name/ID, me, or unassigned")
  .option("--priority <priority>", "none, urgent, high, normal, low, or 0-4")
  .option("--project <project>", "project name or ID, scoped to --team")
  .option("--cycle <cycle>", "cycle name/number/ID/active/next")
  .option("--due-date <date>", "due date YYYY-MM-DD")
  .option("--estimate <n>", "estimate points")
  .option("--parent <issue>", "parent issue identifier or ID")
  .option("--label <label>", "label name/ID (repeatable)", collect, [])
  .option("--apply", "create the issue (dry-run by default)")
  .action(async function (
    this: Command,
    opts: {
      team: string;
      title: string;
      description?: string;
      descriptionFile?: string;
      state?: string;
      assignee?: string;
      priority?: string;
      project?: string;
      cycle?: string;
      dueDate?: string;
      estimate?: string;
      parent?: string;
      label: string[];
      apply?: boolean;
    },
  ) {
    const g = globals(this);
    await run(
      "issue.create",
      g,
      () => createIssue({ ...opts, label: opts.label, debug: g.debug }),
      (data) => {
        if (!data.applied) {
          return `Dry run: would create issue with input:\n${JSON.stringify(data.input, null, 2)}\nRe-run with --apply to execute.`;
        }
        return `Created ${data.result?.identifier}: ${data.result?.url}`;
      },
    );
  });

issue
  .command("archive")
  .description("Archive an issue (dry-run unless --apply)")
  .argument("<issue>", "issue identifier or UUID")
  .option("--trash", "also trash the issue")
  .option("--apply", "execute the archive (dry-run by default)")
  .action(async function (this: Command, ref: string, opts: { trash?: boolean; apply?: boolean }) {
    const g = globals(this);
    await run(
      "issue.archive",
      g,
      () => archiveIssue(ref, { ...opts, debug: g.debug }),
      (data) => {
        if (!data.applied) {
          return `Dry run: would archive ${data.issue.identifier}${data.trash ? " (trash)" : ""}.\nRe-run with --apply to execute.`;
        }
        return `Archived ${data.issue.identifier}${data.trash ? " (trashed)" : ""}`;
      },
    );
  });

issue
  .command("unarchive")
  .description("Unarchive an issue (dry-run unless --apply)")
  .argument("<issue>", "issue identifier or UUID")
  .option("--apply", "execute the unarchive (dry-run by default)")
  .action(async function (this: Command, ref: string, opts: { apply?: boolean }) {
    const g = globals(this);
    await run(
      "issue.unarchive",
      g,
      () => unarchiveIssue(ref, { ...opts, debug: g.debug }),
      (data) => {
        if (!data.applied) {
          return `Dry run: would unarchive ${data.issue.identifier}.\nRe-run with --apply to execute.`;
        }
        return `Unarchived ${data.issue.identifier}`;
      },
    );
  });

const relation = issue.command("relation").description("Issue relation commands");

relation
  .command("list")
  .description("List relations for an issue")
  .argument("<issue>", "issue identifier or UUID")
  .action(async function (this: Command, ref: string) {
    const g = globals(this);
    await run(
      "issue.relation.list",
      g,
      () => listIssueRelations(ref, { debug: g.debug }),
      (data) => {
        const { rows, columns } = formatRelationsList(data.relations, data.inverseRelations);
        return `${data.issue.identifier} relations\n${renderTable(rows, columns)}`;
      },
    );
  });

relation
  .command("create")
  .description("Create an issue relation (dry-run unless --apply)")
  .argument("<issue>", "source issue identifier or UUID")
  .requiredOption("--type <type>", "blocks, duplicate, related, or similar")
  .requiredOption("--related <issue>", "related issue identifier or UUID")
  .option("--apply", "create the relation (dry-run by default)")
  .action(async function (
    this: Command,
    ref: string,
    opts: { type: string; related: string; apply?: boolean },
  ) {
    const g = globals(this);
    await run(
      "issue.relation.create",
      g,
      () => createIssueRelation(ref, { ...opts, debug: g.debug }),
      (data) => {
        if (!data.applied) {
          return `Dry run: would create relation ${data.issue.identifier} --${data.input.type}-> ${data.related.identifier}\nInput:\n${JSON.stringify(data.input, null, 2)}\nRe-run with --apply to execute.`;
        }
        return `Created relation ${data.relation?.id}: ${data.issue.identifier} --${data.relation?.type}-> ${data.related.identifier}`;
      },
    );
  });

relation
  .command("delete")
  .description("Delete an issue relation by ID (dry-run unless --apply)")
  .argument("<id>", "relation ID")
  .option("--apply", "delete the relation (dry-run by default)")
  .action(async function (this: Command, id: string, opts: { apply?: boolean }) {
    const g = globals(this);
    await run(
      "issue.relation.delete",
      g,
      () => deleteIssueRelation(id, { ...opts, debug: g.debug }),
      (data) => {
        if (!data.applied) {
          return `Dry run: would delete relation ${data.id}.\nRe-run with --apply to execute.`;
        }
        return `Deleted relation ${data.id}`;
      },
    );
  });

program
  .command("states")
  .description("Workflow state discovery")
  .command("list")
  .description("List workflow states")
  .option("--team <team>", "team key, name, or ID")
  .action(async function (this: Command, opts: { team?: string }) {
    const g = globals(this);
    await run(
      "states.list",
      g,
      () => listStates({ team: opts.team, debug: g.debug }),
      (data) => {
        const { rows, columns } = formatStatesList(data);
        return renderTable(rows, columns);
      },
    );
  });

program
  .command("labels")
  .description("Issue label discovery")
  .command("list")
  .description("List issue labels")
  .option("--team <team>", "team key, name, or ID")
  .option("--include-workspace", "include workspace-level labels when --team is set")
  .action(async function (this: Command, opts: { team?: string; includeWorkspace?: boolean }) {
    const g = globals(this);
    await run(
      "labels.list",
      g,
      () =>
        listLabels({ team: opts.team, includeWorkspace: opts.includeWorkspace, debug: g.debug }),
      (data) => {
        const { rows, columns } = formatLabelsList(data);
        return renderTable(rows, columns);
      },
    );
  });

const project = program.command("project").description("Project discovery");

project
  .command("list")
  .description("List projects")
  .option("--team <team>", "filter to projects accessible by team key/name/ID")
  .option("--include-archived", "include archived projects")
  .option("--limit <n>", "max projects to return", (v) => Number(v))
  .action(async function (
    this: Command,
    opts: { team?: string; includeArchived?: boolean; limit?: number },
  ) {
    const g = globals(this);
    await run(
      "project.list",
      g,
      () => listProjects({ ...opts, debug: g.debug }),
      (data) => {
        const { rows, columns } = formatProjectsList(data);
        return renderTable(rows, columns);
      },
    );
  });

project
  .command("get")
  .description("Get a project by name or ID")
  .argument("<project>", "project name or ID")
  .option("--team <team>", "disambiguate by team key/name/ID")
  .action(async function (this: Command, ref: string, opts: { team?: string }) {
    const g = globals(this);
    await run(
      "project.get",
      g,
      () => getProject(ref, { team: opts.team, debug: g.debug }),
      formatProject,
    );
  });

program
  .command("cycle")
  .description("Cycle discovery")
  .command("list")
  .description("List cycles for a team")
  .requiredOption("--team <team>", "team key, name, or ID")
  .option("--only <filter>", "active, next, past, or future")
  .option("--include-archived", "include archived cycles")
  .option("--limit <n>", "max cycles to return", (v) => Number(v))
  .action(async function (
    this: Command,
    opts: {
      team: string;
      only?: string;
      includeArchived?: boolean;
      limit?: number;
    },
  ) {
    const g = globals(this);
    await run(
      "cycle.list",
      g,
      () => {
        const only = opts.only?.toLowerCase();
        if (only && !["active", "next", "past", "future"].includes(only)) {
          throw new ConfigError("--only must be one of active, next, past, future");
        }
        return listCycles({
          team: opts.team,
          only: only as "active" | "next" | "past" | "future" | undefined,
          includeArchived: opts.includeArchived,
          limit: opts.limit,
          debug: g.debug,
        });
      },
      (data) => {
        const { rows, columns } = formatCyclesList(data);
        return renderTable(rows, columns);
      },
    );
  });

const notification = program.command("notification").description("Inbox notification workflow");

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
      (data) => {
        const { rows, columns } = formatNotificationsList(data);
        return renderTable(rows, columns);
      },
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

entitySelectorOptions(
  notification
    .command("mark-read")
    .description("Mark notification(s) for an entity as read (dry-run unless --apply)")
    .option("--read-at <iso>", "read timestamp (defaults to now)")
    .option("--apply", "execute the mutation (dry-run by default)"),
).action(async function (
  this: Command,
  opts: {
    id?: string;
    issue?: string;
    project?: string;
    initiative?: string;
    projectUpdate?: string;
    initiativeUpdate?: string;
    oauthClientApproval?: string;
    readAt?: string;
    apply?: boolean;
  },
) {
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
).action(async function (
  this: Command,
  opts: {
    id?: string;
    issue?: string;
    project?: string;
    initiative?: string;
    projectUpdate?: string;
    initiativeUpdate?: string;
    oauthClientApproval?: string;
    apply?: boolean;
  },
) {
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
).action(async function (
  this: Command,
  opts: {
    id?: string;
    issue?: string;
    project?: string;
    initiative?: string;
    projectUpdate?: string;
    initiativeUpdate?: string;
    oauthClientApproval?: string;
    until: string;
    apply?: boolean;
  },
) {
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
).action(async function (
  this: Command,
  opts: {
    id?: string;
    issue?: string;
    project?: string;
    initiative?: string;
    projectUpdate?: string;
    initiativeUpdate?: string;
    oauthClientApproval?: string;
    at?: string;
    apply?: boolean;
  },
) {
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
).action(async function (
  this: Command,
  opts: {
    id?: string;
    issue?: string;
    project?: string;
    initiative?: string;
    projectUpdate?: string;
    initiativeUpdate?: string;
    oauthClientApproval?: string;
    apply?: boolean;
  },
) {
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
        return data.notification ? formatNotification(data.notification) : `Unarchived ${data.id}`;
      },
    );
  });

const subscription = notification
  .command("subscription")
  .description("Notification subscription management");

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
    "subscription notification type (repeatable; e.g. issue, project, pullRequest)",
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
    if (opts.active && opts.inactive) {
      throw new ConfigError("Use either --active or --inactive, not both.");
    }
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

subscription
  .command("update")
  .description("Update a notification subscription (dry-run unless --apply)")
  .argument("<id>", "subscription ID")
  .option("--type <type>", "subscription notification type (repeatable)", collect, [])
  .option("--active", "set active")
  .option("--inactive", "set inactive")
  .option("--apply", "execute the update (dry-run by default)")
  .action(async function (
    this: Command,
    id: string,
    opts: { type?: string[]; active?: boolean; inactive?: boolean; apply?: boolean },
  ) {
    const g = globals(this);
    if (opts.active && opts.inactive) {
      throw new ConfigError("Use either --active or --inactive, not both.");
    }
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
        const header = [
          "Channel master switches:",
          `  desktop=${channel.desktop ? "on" : "off"} mobile=${channel.mobile ? "on" : "off"} email=${channel.email ? "on" : "off"} slack=${channel.slack ? "on" : "off"}`,
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

await program.parseAsync(process.argv);
