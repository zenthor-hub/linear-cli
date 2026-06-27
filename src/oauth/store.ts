import { chmod, mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { ConfigError } from "../errors.ts";
import type { OAuthSession, StoredCredentials } from "./types.ts";

const DEFAULT_STORE_DIR = join(homedir(), ".config", "linear-cli");
const DEFAULT_STORE_FILE = join(DEFAULT_STORE_DIR, "credentials.json");

export function credentialsFilePath(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.LINEAR_CREDENTIALS_FILE?.trim();
  return override || DEFAULT_STORE_FILE;
}

async function ensureParentDir(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
}

function parseStoredCredentials(raw: string): StoredCredentials {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ConfigError(`Invalid credentials file: ${message}`);
  }

  if (typeof parsed !== "object" || parsed === null || !("kind" in parsed)) {
    throw new ConfigError("Invalid credentials file: missing kind.");
  }

  const cred = parsed as StoredCredentials;
  if (cred.kind === "oauth") {
    if (!cred.accessToken || !cred.refreshToken || !cred.expiresAt || !cred.clientId) {
      throw new ConfigError("Invalid OAuth session in credentials file.");
    }
    return cred;
  }

  if (cred.kind === "client_credentials") {
    if (!cred.accessToken || !cred.expiresAt || !cred.clientId) {
      throw new ConfigError("Invalid client credentials session in credentials file.");
    }
    return cred;
  }

  throw new ConfigError("Invalid credentials file: unknown kind.");
}

export async function loadStoredCredentials(
  env: NodeJS.ProcessEnv = process.env,
): Promise<StoredCredentials | null> {
  const path = credentialsFilePath(env);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }

  try {
    const fileStat = await stat(path);
    if ((fileStat.mode & 0o077) !== 0) {
      process.stderr.write(
        `warning: credentials file ${path} is world/group-readable; consider chmod 600\n`,
      );
    }
  } catch {
    // Non-fatal if stat fails.
  }

  return parseStoredCredentials(raw);
}

export async function saveOAuthSession(
  session: OAuthSession,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const path = credentialsFilePath(env);
  await ensureParentDir(path);
  await writeFile(path, `${JSON.stringify(session, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  try {
    await chmod(path, 0o600);
  } catch {
    // Best effort on platforms that restrict chmod.
  }
}

export async function clearStoredCredentials(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const path = credentialsFilePath(env);
  try {
    await unlink(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
}

export function sessionFromTokenResponse(
  token: {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope: string;
    token_type: string;
  },
  clientId: string,
  existing?: Partial<OAuthSession>,
): OAuthSession {
  if (!token.refresh_token) {
    throw new ConfigError("OAuth token response missing refresh_token.");
  }
  return {
    kind: "oauth",
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: Date.now() + token.expires_in * 1000,
    scope: token.scope,
    tokenType: "Bearer",
    clientId,
    userId: existing?.userId,
    organizationId: existing?.organizationId,
  };
}
