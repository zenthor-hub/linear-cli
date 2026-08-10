#!/usr/bin/env node
import { Command } from "commander";

import { addAuthCommands } from "./cli/auth.ts";
import { addNotificationCommands } from "./cli/notifications.ts";
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
  formatRelationsList,
  formatStatesList,
  getIssue,
  listIssueComments,
  listIssueRelations,
  listStates,
  searchIssues,
  unarchiveIssue,
  updateIssue,
} from "./commands/issues.ts";
import { createLabel, formatLabelsList, listLabels } from "./commands/labels.ts";
import {
  formatProject,
  formatProjectUpdatesList,
  formatProjectsList,
  getProject,
  listProjects,
  listProjectUpdates,
  postProjectUpdate,
  updateProject,
} from "./commands/projects.ts";
import { ConfigError } from "./errors.ts";
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
  .option("--project <project>", "project name or ID; scoped to --team when provided")
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
      project?: string;
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

const labels = program.command("labels").description("Issue label discovery and create");

labels
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

labels
  .command("create")
  .description("Create an issue label (dry-run unless --apply)")
  .requiredOption("--name <name>", "label name")
  .option("--color <hex>", "hex color (e.g. #0ea5e9)")
  .option("--description <text>", "label description")
  .option("--team <team>", "team key/name/ID for a team-scoped label (omit for workspace)")
  .option("--parent <label>", "parent label group name or ID")
  .option(
    "--replace-team-labels",
    "when creating a workspace label, replace same-named team labels",
  )
  .option("--apply", "create the label (dry-run by default)")
  .action(async function (
    this: Command,
    opts: {
      name: string;
      color?: string;
      description?: string;
      team?: string;
      parent?: string;
      replaceTeamLabels?: boolean;
      apply?: boolean;
    },
  ) {
    const g = globals(this);
    await run(
      "labels.create",
      g,
      () =>
        createLabel({
          name: opts.name,
          color: opts.color,
          description: opts.description,
          team: opts.team,
          parent: opts.parent,
          replaceTeamLabels: opts.replaceTeamLabels,
          apply: opts.apply,
          debug: g.debug,
        }),
      (data) => {
        if (!data.applied) {
          return `Dry run: would create label with input:\n${JSON.stringify(data.input, null, 2)}${data.replaceTeamLabels ? "\nreplaceTeamLabels: true" : ""}\nRe-run with --apply to execute.`;
        }
        const label = data.result;
        const scope = label?.team?.key ?? "(workspace)";
        return `Created label ${label?.name} (${label?.id}) scope=${scope} color=${label?.color ?? ""}`;
      },
    );
  });

const project = program.command("project").description("Project discovery and update commands");

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

project
  .command("update")
  .description("Update a project (dry-run unless --apply)")
  .argument("<project>", "project name or ID")
  .option("--description <text>", "new short project description (max 255 Unicode characters)")
  .option("--description-file <file>", "read the new short project description from a file")
  .option("--name <name>", "new project name")
  .option("--status <status>", "project status name, type, or ID")
  .option("--start-date <date>", "start date YYYY-MM-DD, or none to clear")
  .option("--target-date <date>", "target date YYYY-MM-DD, or none to clear")
  .option("--team <team>", "disambiguate the project by team key/name/ID")
  .option("--apply", "execute the update (dry-run by default)")
  .action(async function (
    this: Command,
    ref: string,
    opts: {
      description?: string;
      descriptionFile?: string;
      name?: string;
      status?: string;
      startDate?: string;
      targetDate?: string;
      team?: string;
      apply?: boolean;
    },
  ) {
    const g = globals(this);
    await run(
      "project.update",
      g,
      () => updateProject(ref, { ...opts, debug: g.debug }),
      (data) => {
        if (!data.applied) {
          if (Object.keys(data.input).length === 0) {
            return `No changes for project ${data.project.name} (${data.project.id}).`;
          }
          return `Dry run: would update project ${data.project.name} (${data.project.id}) with input:\n${JSON.stringify(data.input, null, 2)}\nPlanned changes:\n${JSON.stringify(data.plannedChanges, null, 2)}\nRe-run with --apply to execute.`;
        }
        return `Updated ${data.result?.name ?? data.project.name} (${data.result?.id ?? data.project.id}) -> ${data.result?.url ?? data.project.url}`;
      },
    );
  });

project
  .command("post-update")
  .description("Post a project status update (dry-run unless --apply)")
  .argument("<project>", "project name or ID")
  .option("--body <markdown>", "project status-update body (not the project description)")
  .option("--body-file <file>", "read the project status-update body from a file")
  .requiredOption("--health <health>", "onTrack, atRisk, or offTrack")
  .option("--team <team>", "disambiguate the project by team key/name/ID")
  .option("--apply", "create the project update (dry-run by default)")
  .action(async function (
    this: Command,
    ref: string,
    opts: { body?: string; bodyFile?: string; health: string; team?: string; apply?: boolean },
  ) {
    const g = globals(this);
    await run(
      "project.post-update",
      g,
      () => postProjectUpdate(ref, { ...opts, debug: g.debug }),
      (data) => {
        if (!data.applied) {
          return `Dry run: would post update to ${data.project.name} (${data.project.id}) with input:\n${JSON.stringify(data.input, null, 2)}\nPlanned changes:\n${JSON.stringify(data.plannedChanges, null, 2)}\nRe-run with --apply to execute.`;
        }
        return `Posted project update ${data.result?.id ?? "(unknown)"} -> ${data.result?.url ?? "(no URL)"}`;
      },
    );
  });

project
  .command("updates")
  .description("List recent updates for a project")
  .argument("<project>", "project name or ID")
  .option("--team <team>", "disambiguate the project by team key/name/ID")
  .option("--limit <n>", "max updates to return (default 50)", (v) => Number(v))
  .action(async function (this: Command, ref: string, opts: { team?: string; limit?: number }) {
    const g = globals(this);
    await run(
      "project.updates",
      g,
      () => listProjectUpdates(ref, { ...opts, debug: g.debug }),
      (data) => {
        const { rows, columns } = formatProjectUpdatesList(data.updates);
        return `${data.project.name} updates (${data.updates.length})\n${renderTable(rows, columns)}`;
      },
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

addNotificationCommands(program);

await program.parseAsync(process.argv);
