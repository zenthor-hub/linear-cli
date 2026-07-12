#!/usr/bin/env node
import { Command } from "commander";

import { addAuthCommands, addAuthTokenCommand } from "./cli/auth.ts";
import { addGlobalOptions, collect, globals, run } from "./cli/shared.ts";
import { DEFAULT_LINEAR_ADMIN_SCOPE } from "./commands/auth.ts";
import { runGql } from "./commands/gql.ts";
import { formatTeamsList, listTeams } from "./commands/teams.ts";
import { formatUsersList, listUsers } from "./commands/users.ts";
import {
  createWebhook,
  deleteWebhook,
  formatWebhooksList,
  listWebhooks,
} from "./commands/webhooks.ts";
import { renderTable } from "./output/format.ts";

const program = new Command();

addGlobalOptions(
  program
    .name("linear-admin")
    .description("Focused administrative CLI for Linear operations not exposed via the MCP."),
);

const auth = addAuthCommands(program, { defaultScope: DEFAULT_LINEAR_ADMIN_SCOPE });
addAuthTokenCommand(auth);

program
  .command("gql")
  .description("Run an explicit GraphQL document from a .graphql file")
  .argument("<file>", "path to a .graphql document")
  .option("--vars <file>", "path to a JSON variables file")
  .option("--apply", "execute mutations (mutations are dry-run by default)")
  .action(async function (this: Command, file: string, opts: { vars?: string; apply?: boolean }) {
    const g = globals(this);
    await run(
      "gql",
      g,
      () => runGql(file, { ...opts, debug: g.debug }),
      (data) => {
        if (data.isMutation && !data.applied) {
          return "Dry run: document contains a mutation. Re-run with --apply to execute.";
        }
        return JSON.stringify(data.result, null, 2);
      },
    );
  });

const webhooks = program.command("webhooks").description("Organization webhook administration");

webhooks
  .command("list")
  .description("List organization webhooks")
  .action(async function (this: Command) {
    const g = globals(this);
    await run(
      "webhooks.list",
      g,
      () => listWebhooks({ debug: g.debug }),
      (data) => {
        const { rows, columns } = formatWebhooksList(data);
        return renderTable(rows, columns);
      },
    );
  });

webhooks
  .command("create")
  .description("Create a webhook (dry-run unless --apply)")
  .requiredOption("--url <url>", "HTTPS endpoint to deliver events to")
  .option("--team <id>", "team ID to scope the webhook to")
  .option("--all-public-teams", "scope the webhook to all public teams")
  .option("--resource <type>", "resource type to subscribe to (repeatable)", collect, [])
  .option("--label <label>", "human-readable label")
  .option("--apply", "execute the mutation (dry-run by default)")
  .action(async function (
    this: Command,
    opts: {
      url: string;
      team?: string;
      allPublicTeams?: boolean;
      resource: string[];
      label?: string;
      apply?: boolean;
    },
  ) {
    const g = globals(this);
    await run(
      "webhooks.create",
      g,
      () =>
        createWebhook({
          url: opts.url,
          team: opts.team,
          allPublicTeams: opts.allPublicTeams,
          resources: opts.resource,
          label: opts.label,
          apply: opts.apply,
          debug: g.debug,
        }),
      (data) => {
        if (!data.applied) {
          return `Dry run: would create webhook with input:\n${JSON.stringify(data.input, null, 2)}\nRe-run with --apply to execute.`;
        }
        return `Created webhook ${data.webhook?.id} -> ${data.webhook?.url}`;
      },
    );
  });

webhooks
  .command("delete")
  .description("Delete a webhook by ID (dry-run unless --apply)")
  .argument("<id>", "webhook ID")
  .option("--apply", "execute the deletion (dry-run by default)")
  .action(async function (this: Command, id: string, opts: { apply?: boolean }) {
    const g = globals(this);
    await run(
      "webhooks.delete",
      g,
      () => deleteWebhook(id, { apply: opts.apply, debug: g.debug }),
      (data) => {
        if (!data.applied) {
          return `Dry run: would delete webhook ${data.webhook.id} -> ${data.webhook.url} (team: ${data.webhook.team?.name ?? "all public"})\nRe-run with --apply to execute.`;
        }
        return `Deleted webhook ${data.webhook.id} -> ${data.webhook.url}`;
      },
    );
  });

const teams = program.command("teams").description("Team discovery and audits");

teams
  .command("list")
  .description("List teams")
  .option("--include-archived", "include archived teams")
  .option("--private", "only private teams")
  .option("--public", "only public teams")
  .action(async function (
    this: Command,
    opts: { includeArchived?: boolean; private?: boolean; public?: boolean },
  ) {
    const g = globals(this);
    await run(
      "teams.list",
      g,
      () =>
        listTeams({
          includeArchived: opts.includeArchived,
          privateOnly: opts.private,
          publicOnly: opts.public,
          debug: g.debug,
        }),
      (data) => {
        const { rows, columns } = formatTeamsList(data);
        return renderTable(rows, columns);
      },
    );
  });

const users = program.command("users").description("User discovery and access audits");

users
  .command("list")
  .description("List users")
  .option("--include-archived", "include archived users")
  .option("--admin", "only admins")
  .option("--active", "only active users")
  .option("--inactive", "only deactivated users")
  .action(async function (
    this: Command,
    opts: { includeArchived?: boolean; admin?: boolean; active?: boolean; inactive?: boolean },
  ) {
    const g = globals(this);
    await run(
      "users.list",
      g,
      () =>
        listUsers({
          includeArchived: opts.includeArchived,
          adminOnly: opts.admin,
          activeOnly: opts.active,
          inactiveOnly: opts.inactive,
          debug: g.debug,
        }),
      (data) => {
        const { rows, columns } = formatUsersList(data);
        return renderTable(rows, columns);
      },
    );
  });

await program.parseAsync(process.argv);
