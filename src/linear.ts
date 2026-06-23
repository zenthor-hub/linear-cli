#!/usr/bin/env bun
import { Command } from "commander";

import { addGlobalOptions, collect, globals, run } from "./cli/shared.ts";
import { formatWhoami, whoami } from "./commands/auth.ts";
import {
  commentOnIssue,
  createIssue,
  formatIssue,
  formatIssuesList,
  formatLabelsList,
  formatStatesList,
  getIssue,
  listLabels,
  listStates,
  searchIssues,
  updateIssue,
} from "./commands/issues.ts";
import { renderTable } from "./output/format.ts";

const program = new Command();

addGlobalOptions(
  program.name("linear").description("Linear issue workflow CLI for agents and humans."),
);

const auth = program.command("auth").description("Authentication and identity");
auth
  .command("whoami")
  .description("Verify credentials and show the authenticated user/workspace")
  .action(async function (this: Command) {
    const g = globals(this);
    await run("auth.whoami", g, () => whoami({ debug: g.debug }), formatWhoami);
  });

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
  .description("Search issues with structured filters")
  .option("--team <team>", "team key, name, or ID")
  .option("--state <state>", "state name/type/ID; requires --team")
  .option("--assignee <user>", "assignee email/name/ID, me, or unassigned")
  .option("--include-archived", "include archived issues")
  .action(async function (
    this: Command,
    opts: { team?: string; state?: string; assignee?: string; includeArchived?: boolean },
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
  .option("--label <label>", "replace labels by name/ID (repeatable)", collect, [])
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
      label: string[];
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
  .command("create")
  .description("Create an issue (dry-run unless --apply)")
  .requiredOption("--team <team>", "team key, name, or ID")
  .requiredOption("--title <title>", "issue title")
  .option("--description <markdown>", "markdown description")
  .option("--description-file <file>", "read markdown description from a file")
  .option("--state <state>", "state name/type/ID")
  .option("--assignee <user>", "assignee email/name/ID, me, or unassigned")
  .option("--priority <priority>", "none, urgent, high, normal, low, or 0-4")
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

await program.parseAsync(process.argv);
