import type { Command } from "commander";

import {
  authLogin,
  authLogout,
  authProfileAddKey,
  authProfileList,
  authProfileRename,
  authStatus,
  authToken,
  formatAuthLogin,
  formatAuthLogout,
  formatAuthProfileList,
  formatAuthProfileRename,
  formatAuthStatus,
  formatAuthToken,
  formatWhoami,
  whoami,
} from "../commands/auth.ts";
import { ConfigError } from "../errors.ts";
import { globals, run } from "./shared.ts";

export interface AuthCommandOptions {
  defaultScope: string;
}

/** Register the shared authentication command tree for either CLI entrypoint. */
export function addAuthCommands(program: Command, options: AuthCommandOptions): Command {
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
    .option("--scope <scopes>", "comma-separated OAuth scopes", options.defaultScope)
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
            defaultScope: options.defaultScope,
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
      await run("auth.logout", g, () => logoutOrThrow(g.debug), formatAuthLogout);
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
          return logoutOrThrow(g.debug);
        },
        formatAuthLogout,
      );
    });

  profile
    .command("rename")
    .description("Rename the selected local credential profile without changing Linear")
    .argument("<new-name>", "new profile name")
    .action(async function (this: Command, newName: string) {
      const g = globals(this);
      await run(
        "auth.profile.rename",
        g,
        () => authProfileRename(newName),
        formatAuthProfileRename,
      );
    });

  return auth;
}

async function logoutOrThrow(debug?: boolean) {
  const result = await authLogout({ debug });
  if (!result.cleared) {
    throw new ConfigError(`OAuth token revocation failed: ${result.errors.join("; ")}`);
  }
  return result;
}

/** Register the admin-only client-credentials command explicitly. */
export function addAuthTokenCommand(auth: Command): void {
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
      await run("auth.token", g, () => authToken({ ...opts, debug: g.debug }), formatAuthToken);
    });
}
