#!/usr/bin/env node
import { Command } from "commander";

import { addGlobalOptions, collect, globals, run } from "./cli/shared.ts";
import {
  DEFAULT_LINEAR_ADMIN_SCOPE,
  authLogin,
  authLogout,
  authProfileAddKey,
  authProfileList,
  authStatus,
  authToken,
  formatAuthLogin,
  formatAuthLogout,
  formatAuthProfileList,
  formatAuthStatus,
  formatAuthToken,
  formatWhoami,
  whoami,
} from "./commands/auth.ts";
import { runGql } from "./commands/gql.ts";
import { formatTeamsList, listTeams } from "./commands/teams.ts";
import { formatUsersList, listUsers } from "./commands/users.ts";
import {
  createWebhook,
  deleteWebhook,
  formatWebhooksList,
  listWebhooks,
} from "./commands/webhooks.ts";
import { ConfigError } from "./errors.ts";
import { renderTable } from "./output/format.ts";

const program = new Command();

addGlobalOptions(
  program
    .name("linear-admin")
    .description("Focused administrative CLI for Linear operations not exposed via the MCP."),
);

const auth = program.command("auth").description("Authentication and identity");
auth
  .command("whoami")
  .description("Verify credentials and show the authenticated user/workspace")
  .action(async function (this: Command) {
    const g = globals(this);
    await run("auth.whoami", g, () => whoami({ debug: g.debug }), formatWhoami);
  });

auth
  .command("login")
  .description("Log in with Linear OAuth (stores credentials locally)")
  .option("--scope <scopes>", "comma-separated OAuth scopes", DEFAULT_LINEAR_ADMIN_SCOPE)
  .option("--redirect-uri <uri>", "OAuth redirect URI (default http://127.0.0.1:8787/callback)")
  .option("--client-id <id>", "OAuth client ID (default LINEAR_CLIENT_ID)")
  .option("--client-secret <secret>", "OAuth client secret (optional for PKCE)")
  .option("--no-open", "print authorize URL instead of opening a browser")
  .option("--replace", "replace an existing selected profile")
  .action(async function (
    this: Command,
    opts: {
      scope?: string;
      redirectUri?: string;
      clientId?: string;
      clientSecret?: string;
      open?: boolean;
      replace?: boolean;
    },
  ) {
    const g = globals(this);
    await run(
      "auth.login",
      g,
      () =>
        authLogin({
          ...opts,
          noOpen: opts.open === false,
          defaultScope: DEFAULT_LINEAR_ADMIN_SCOPE,
          debug: g.debug,
        }),
      formatAuthLogin,
    );
  });

auth
  .command("logout")
  .description("Revoke stored OAuth credentials and clear the local session")
  .action(async function (this: Command) {
    const g = globals(this);
    await run("auth.logout", g, () => authLogout({ debug: g.debug }), formatAuthLogout);
  });

auth
  .command("status")
  .description("Show authentication status without mutating credentials")
  .action(async function (this: Command) {
    const g = globals(this);
    await run("auth.status", g, () => authStatus({ debug: g.debug }), formatAuthStatus);
  });

const profile = auth.command("profile").description("Manage opt-in named credential profiles");
profile
  .command("list")
  .description("List stored credential profiles without exposing secrets")
  .action(async function (this: Command) {
    const g = globals(this);
    await run("auth.profile.list", g, () => authProfileList(), formatAuthProfileList);
  });

profile
  .command("add-key")
  .description("Verify and store an API key for the selected --profile (reads stdin)")
  .option("--replace", "replace an existing selected profile")
  .action(async function (this: Command, opts: { replace?: boolean }) {
    const g = globals(this);
    await run("auth.profile.add-key", g, () => authProfileAddKey(opts), formatWhoami);
  });

profile
  .command("remove")
  .description("Revoke OAuth credentials when possible and remove the selected --profile")
  .action(async function (this: Command) {
    const g = globals(this);
    await run(
      "auth.profile.remove",
      g,
      () => {
        if (!g.profile && !process.env.LINEAR_PROFILE) {
          throw new ConfigError("Select a profile with --profile <name> before removing it.");
        }
        return authLogout({ debug: g.debug });
      },
      formatAuthLogout,
    );
  });

auth
  .command("token")
  .description("Fetch a client-credentials OAuth token for headless use")
  .requiredOption("--scope <scopes>", "comma-separated OAuth scopes")
  .option("--client-id <id>", "OAuth client ID (default LINEAR_CLIENT_ID)")
  .option("--client-secret <secret>", "OAuth client secret (default LINEAR_CLIENT_SECRET)")
  .option("--print-env", "print export LINEAR_ACCESS_TOKEN=... for shell use")
  .action(async function (
    this: Command,
    opts: { scope: string; clientId?: string; clientSecret?: string; printEnv?: boolean },
  ) {
    const g = globals(this);
    await run(
      "auth.token",
      g,
      () =>
        authToken({
          scope: opts.scope,
          clientId: opts.clientId,
          clientSecret: opts.clientSecret,
          printEnv: opts.printEnv,
          debug: g.debug,
        }),
      formatAuthToken,
    );
  });

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
