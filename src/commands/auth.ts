import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";

import {
  beginStoredCredentialLogout,
  cancelStoredCredentialLogout,
  commitStoredCredentialLogout,
  credentialsFilePath,
  listProfiles,
  renameProfile,
  resolveCredential,
  saveApiKeyProfile,
  saveOAuthSession,
  sessionFromTokenResponse,
  type CredentialSource,
  type OAuthSession,
} from "../config.ts";
import { ConfigError } from "../errors.ts";
import { executeGraphql } from "../graphql/client.ts";
import { VIEWER_QUERY, type ViewerResult } from "../graphql/documents.ts";
import { buildAuthorizeUrl } from "../oauth/authorize.ts";
import { waitForOAuthCallback } from "../oauth/callback.ts";
import {
  DEFAULT_LINEAR_ADMIN_SCOPE,
  DEFAULT_LINEAR_SCOPE,
  DEFAULT_REDIRECT_URI,
  LOGIN_TIMEOUT_MS,
} from "../oauth/constants.ts";
import { codeChallengeS256, generateCodeVerifier } from "../oauth/pkce.ts";
import { loadStoredCredentials } from "../oauth/store.ts";
import {
  exchangeAuthorizationCode,
  fetchClientCredentialsToken,
  revokeToken,
} from "../oauth/token.ts";
import type { StoredCredentials } from "../oauth/types.ts";

export interface WhoamiData {
  user: { id: string; name: string; email: string };
  organization: { id: string; name: string; urlKey: string };
  credentialKind: "oauth" | "apiKey";
  credentialSource: CredentialSource;
  expiresAt?: number;
  scope?: string;
}

export interface AuthStatusData {
  authenticated: boolean;
  credentialSource: CredentialSource | "none";
  credentialKind?: "oauth" | "apiKey";
  storePath: string;
  expiresAt?: number;
  scope?: string;
  clientId?: string;
  user?: { id: string; name: string; email: string };
  organization?: { id: string; name: string; urlKey: string };
}

export interface AuthLoginOptions {
  scope?: string;
  redirectUri?: string;
  clientId?: string;
  clientSecret?: string;
  noOpen?: boolean;
  replace?: boolean;
  debug?: boolean;
  /** Default scopes differ between linear and linear-admin entrypoints. */
  defaultScope?: string;
}

export interface AuthTokenOptions {
  scope: string;
  clientId?: string;
  clientSecret?: string;
  printEnv?: boolean;
  debug?: boolean;
}

export interface AuthProfileData {
  name: string;
  kind: string;
  organizationName?: string;
  organizationUrlKey?: string;
  expiresAt?: number;
}

function readOAuthAppConfig(
  env: NodeJS.ProcessEnv,
  overrides: { clientId?: string; clientSecret?: string; redirectUri?: string },
) {
  const clientId = overrides.clientId?.trim() || env.LINEAR_CLIENT_ID?.trim();
  const clientSecret = overrides.clientSecret?.trim() || env.LINEAR_CLIENT_SECRET?.trim();
  const redirectUri =
    overrides.redirectUri?.trim() || env.LINEAR_OAUTH_REDIRECT_URI?.trim() || DEFAULT_REDIRECT_URI;

  if (!clientId) {
    throw new ConfigError(
      "LINEAR_CLIENT_ID is required for OAuth login. Create an OAuth app at https://linear.app/settings/api/applications/new",
    );
  }

  return { clientId, clientSecret, redirectUri };
}

async function openBrowser(url: string): Promise<void> {
  const platform = process.platform;
  const command = platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args =
    platform === "win32" ? ["/c", "start", "", url] : platform === "darwin" ? [url] : [url];

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: "ignore", detached: true });
    child.on("error", reject);
    child.unref();
    resolve();
  });
}

export async function whoami(opts: { debug?: boolean }): Promise<WhoamiData> {
  const credential = await resolveCredential();
  const result = await executeGraphql<ViewerResult>(
    VIEWER_QUERY,
    {},
    {
      credential,
      debug: opts.debug,
    },
  );
  return {
    user: result.viewer,
    organization: result.organization,
    credentialKind: credential.kind,
    credentialSource: credential.source,
  };
}

export function formatWhoami(data: WhoamiData): string {
  const source =
    data.credentialSource === "store"
      ? data.credentialKind === "apiKey"
        ? "stored API key profile"
        : "stored OAuth session"
      : data.credentialSource === "accessToken"
        ? "LINEAR_ACCESS_TOKEN"
        : data.credentialSource === "clientCredentials"
          ? "client credentials"
          : data.credentialSource === "apiKey"
            ? "LINEAR_API_KEY"
            : data.credentialKind === "oauth"
              ? "OAuth access token"
              : "personal API key";

  return (
    `Authenticated as ${data.user.name} <${data.user.email}>\n` +
    `Organization: ${data.organization.name} (${data.organization.urlKey})\n` +
    `Credential: ${data.credentialKind === "oauth" ? "OAuth access token" : "personal API key"} (${source})`
  );
}

function storedStatusFields(stored: StoredCredentials | null): Partial<AuthStatusData> {
  if (!stored) return {};
  if (stored.kind === "apiKey") return {};
  return {
    expiresAt: stored.expiresAt,
    scope: stored.scope,
    clientId: stored.clientId,
  };
}

export async function authStatus(opts: { debug?: boolean }): Promise<AuthStatusData> {
  const env = process.env;
  const storePath = credentialsFilePath(env);
  const stored = await loadStoredCredentials(env).catch(() => null);

  try {
    const data = await whoami({ debug: opts.debug });
    return {
      authenticated: true,
      credentialSource: data.credentialSource,
      credentialKind: data.credentialKind,
      storePath,
      ...storedStatusFields(stored),
      user: data.user,
      organization: data.organization,
    };
  } catch (err) {
    if (err instanceof ConfigError) {
      return {
        authenticated: false,
        credentialSource: "none",
        storePath,
        ...storedStatusFields(stored),
      };
    }
    throw err;
  }
}

export function formatAuthStatus(data: AuthStatusData): string {
  if (!data.authenticated) {
    const hint = data.expiresAt
      ? "Stored credentials exist but are not usable. Run `linear auth login`."
      : "Not authenticated. Run `linear auth login` or set LINEAR_API_KEY.";
    return hint;
  }

  const lines = [
    "Authenticated: yes",
    `Source: ${data.credentialSource}`,
    `Store: ${data.storePath}`,
  ];
  if (data.scope) lines.push(`Scope: ${data.scope}`);
  if (data.expiresAt) {
    const hours = Math.max(0, Math.round((data.expiresAt - Date.now()) / 3_600_000));
    lines.push(`Expires in: ~${hours}h`);
  }
  if (data.user) lines.push(`User: ${data.user.name} <${data.user.email}>`);
  if (data.organization) {
    lines.push(`Organization: ${data.organization.name} (${data.organization.urlKey})`);
  }
  return lines.join("\n");
}

export async function authLogin(opts: AuthLoginOptions): Promise<WhoamiData> {
  const env = process.env;
  if (env.LINEAR_API_KEY || env.LINEAR_ACCESS_TOKEN) {
    throw new ConfigError(
      "OAuth login stores a local session. Unset LINEAR_API_KEY and LINEAR_ACCESS_TOKEN first.",
    );
  }
  if (env.LINEAR_PROFILE?.trim() && (await loadStoredCredentials(env)) && !opts.replace) {
    throw new ConfigError(
      `Profile \`${env.LINEAR_PROFILE}\` already exists. Pass --replace to overwrite it.`,
    );
  }

  const { clientId, clientSecret, redirectUri } = readOAuthAppConfig(env, opts);
  const scope = opts.scope?.trim() || opts.defaultScope || DEFAULT_LINEAR_SCOPE;
  const state = base64Url(randomBytes(24));
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = codeChallengeS256(codeVerifier);
  const authorizeUrl = buildAuthorizeUrl({
    clientId,
    redirectUri,
    scope,
    state,
    codeChallenge,
  });

  process.stderr.write("Opening browser for Linear login...\n");
  if (!opts.noOpen) {
    try {
      await openBrowser(authorizeUrl);
    } catch {
      process.stderr.write(`Could not open browser. Visit:\n${authorizeUrl}\n`);
    }
  } else {
    process.stderr.write(`Visit:\n${authorizeUrl}\n`);
  }

  const callback = await waitForOAuthCallback({
    redirectUri,
    expectedState: state,
    timeoutMs: LOGIN_TIMEOUT_MS,
  });

  const token = await exchangeAuthorizationCode({
    code: callback.code,
    redirectUri,
    codeVerifier,
    options: { clientId, clientSecret, debug: opts.debug },
  });

  const session = sessionFromTokenResponse(token, clientId);
  await saveOAuthSession(session, env);

  const credential = await resolveCredential();
  const viewer = await executeGraphql<ViewerResult>(
    VIEWER_QUERY,
    {},
    { credential, debug: opts.debug },
  );
  const updated: OAuthSession = {
    ...session,
    userId: viewer.viewer.id,
    organizationId: viewer.organization.id,
    organizationName: viewer.organization.name,
    organizationUrlKey: viewer.organization.urlKey,
  };
  await saveOAuthSession(updated, env);

  return {
    user: viewer.viewer,
    organization: viewer.organization,
    credentialKind: "oauth",
    credentialSource: "store",
    expiresAt: updated.expiresAt,
    scope: updated.scope,
  };
}

export async function authProfileList(): Promise<AuthProfileData[]> {
  return listProfiles();
}

export async function authProfileRename(newName: string): Promise<{ from: string; to: string }> {
  const from = process.env.LINEAR_PROFILE?.trim();
  if (!from) throw new ConfigError("Select a profile with --profile <name> before renaming it.");
  await renameProfile(from, newName);
  return { from, to: newName };
}

export function formatAuthProfileRename(data: { from: string; to: string }): string {
  return `Renamed profile ${data.from} to ${data.to}.`;
}

export function formatAuthProfileList(data: AuthProfileData[]): string {
  if (data.length === 0) return "No credential profiles configured.";
  return data
    .map((profile) => {
      const organization = profile.organizationName
        ? ` — ${profile.organizationName}${profile.organizationUrlKey ? ` (${profile.organizationUrlKey})` : ""}`
        : "";
      return `${profile.name}: ${profile.kind}${organization}`;
    })
    .join("\n");
}

async function readApiKeyFromStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    const readline = createInterface({ input: process.stdin, output: process.stderr });
    try {
      return (await readline.question("Paste Linear API key, then press Enter: ")).trim();
    } finally {
      readline.close();
    }
  }

  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8").trim();
}

export async function authProfileAddKey(opts: { replace?: boolean } = {}): Promise<WhoamiData> {
  if (!process.env.LINEAR_PROFILE?.trim()) {
    throw new ConfigError("Select a profile with --profile <name> before adding an API key.");
  }
  if ((await loadStoredCredentials(process.env)) && !opts.replace) {
    throw new ConfigError(
      `Profile \`${process.env.LINEAR_PROFILE}\` already exists. Pass --replace to overwrite it.`,
    );
  }
  const apiKey = await readApiKeyFromStdin();
  if (!apiKey) throw new ConfigError("API key input was empty.");

  const credential = {
    kind: "apiKey" as const,
    authorizationHeader: apiKey,
    raw: apiKey,
    source: "store" as const,
  };
  const viewer = await executeGraphql<ViewerResult>(VIEWER_QUERY, {}, { credential });
  await saveApiKeyProfile({
    kind: "apiKey",
    apiKey,
    createdAt: new Date().toISOString(),
    userId: viewer.viewer.id,
    organizationId: viewer.organization.id,
    organizationName: viewer.organization.name,
    organizationUrlKey: viewer.organization.urlKey,
  });
  return {
    user: viewer.viewer,
    organization: viewer.organization,
    credentialKind: "apiKey",
    credentialSource: "store",
  };
}

export function formatAuthLogin(data: WhoamiData): string {
  return (
    `Logged in as ${data.user.name} <${data.user.email}>\n` +
    `Organization: ${data.organization.name} (${data.organization.urlKey})\n` +
    (data.scope ? `Scope: ${data.scope}\n` : "") +
    "Credentials saved for future commands."
  );
}

export type AuthLogoutResult =
  | { status: "cleared"; cleared: true; revocation: "not_applicable" | "revoked" }
  | {
      status: "revocation_failed";
      cleared: false;
      revocation: "failed" | "partial";
      errors: string[];
    };

export async function authLogout(opts: { debug?: boolean }): Promise<AuthLogoutResult> {
  const env = process.env;
  const stored = await beginStoredCredentialLogout(env);
  if (!stored || stored.kind !== "oauth") {
    await commitStoredCredentialLogout(env);
    return { status: "cleared", cleared: true, revocation: "not_applicable" };
  }

  const options = {
    clientId: stored.clientId,
    clientSecret: env.LINEAR_CLIENT_SECRET?.trim() || undefined,
    debug: opts.debug,
  };
  const revocations = await Promise.allSettled([
    revokeToken({
      token: stored.refreshToken,
      tokenTypeHint: "refresh_token",
      options,
    }),
    revokeToken({
      token: stored.accessToken,
      tokenTypeHint: "access_token",
      options,
    }),
  ]);
  const errors = revocations.flatMap((result) =>
    result.status === "rejected"
      ? [result.reason instanceof Error ? result.reason.message : String(result.reason)]
      : [],
  );

  if (errors.length > 0) {
    await cancelStoredCredentialLogout(env);
    return {
      status: "revocation_failed",
      cleared: false,
      revocation: errors.length === revocations.length ? "failed" : "partial",
      errors,
    };
  }

  await commitStoredCredentialLogout(env);
  return { status: "cleared", cleared: true, revocation: "revoked" };
}

export function formatAuthLogout(): string {
  return "Logged out. Local credentials cleared.";
}

export async function authToken(opts: AuthTokenOptions): Promise<{
  applied: boolean;
  scope: string;
  expiresAt: number;
  exportHint?: string;
}> {
  const env = process.env;
  const clientId = opts.clientId?.trim() || env.LINEAR_CLIENT_ID?.trim();
  const clientSecret = opts.clientSecret?.trim() || env.LINEAR_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new ConfigError("Client credentials require LINEAR_CLIENT_ID and LINEAR_CLIENT_SECRET.");
  }

  const token = await fetchClientCredentialsToken({
    scope: opts.scope,
    options: { clientId, clientSecret, debug: opts.debug },
  });

  const expiresAt = Date.now() + token.expires_in * 1000;
  const exportHint = opts.printEnv
    ? `export LINEAR_ACCESS_TOKEN='${token.access_token}'`
    : undefined;

  return {
    applied: true,
    scope: token.scope,
    expiresAt,
    exportHint,
  };
}

export function formatAuthToken(data: {
  scope: string;
  expiresAt: number;
  exportHint?: string;
}): string {
  const hours = Math.max(0, Math.round((data.expiresAt - Date.now()) / 3_600_000));
  const lines = [`Client credentials token fetched (scope: ${data.scope}, expires in ~${hours}h).`];
  if (data.exportHint) lines.push(data.exportHint);
  return lines.join("\n");
}

function base64Url(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export { DEFAULT_LINEAR_ADMIN_SCOPE, DEFAULT_LINEAR_SCOPE };
