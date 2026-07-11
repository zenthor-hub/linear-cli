import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { ConfigError } from "../errors.ts";
import type { ApiKeyProfile, OAuthSession, StoredCredentials } from "./types.ts";

const DEFAULT_STORE_DIR = join(homedir(), ".config", "linear-cli");
const DEFAULT_STORE_FILE = join(DEFAULT_STORE_DIR, "credentials.json");
const PROFILES_DIR = join(DEFAULT_STORE_DIR, "profiles");
const PROFILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function validateProfileName(name: string): string {
  if (!PROFILE_NAME.test(name)) {
    throw new ConfigError(
      "Invalid profile name. Use 1-64 letters, numbers, dots, underscores, or hyphens.",
    );
  }
  return name;
}

export function profileName(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const name = env.LINEAR_PROFILE?.trim();
  if (!name) return undefined;
  return validateProfileName(name);
}

export function profilesDirectory(): string {
  return PROFILES_DIR;
}

function profilePath(name: string): string {
  return join(PROFILES_DIR, `${validateProfileName(name)}.json`);
}

export function credentialsFilePath(env: NodeJS.ProcessEnv = process.env): string {
  const profile = profileName(env);
  if (profile) return join(PROFILES_DIR, `${profile}.json`);
  const override = env.LINEAR_CREDENTIALS_FILE?.trim();
  return override || DEFAULT_STORE_FILE;
}

async function ensureParentDir(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Serialize credential updates from concurrent CLI processes for one credential file. */
export async function withCredentialsLock<T>(
  env: NodeJS.ProcessEnv,
  action: () => Promise<T>,
): Promise<T> {
  const path = credentialsFilePath(env);
  const lockPath = `${path}.lock`;
  await ensureParentDir(path);

  for (let attempt = 0; ; attempt++) {
    try {
      await mkdir(lockPath, { mode: 0o700 });
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      if (attempt >= 119) {
        throw new ConfigError(`Timed out waiting to update credentials file: ${path}`);
      }
      await sleep(25);
    }
  }

  try {
    return await action();
  } finally {
    await rm(lockPath, { recursive: true, force: true });
  }
}

async function writeCredentialsFile(path: string, credentials: StoredCredentials): Promise<void> {
  await ensureParentDir(path);
  const tempPath = `${path}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(credentials, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  try {
    await chmod(tempPath, 0o600);
  } catch {
    // Best effort on platforms that restrict chmod.
  }
  await rename(tempPath, path);
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

  if (cred.kind === "apiKey") {
    if (!cred.apiKey || !cred.createdAt) {
      throw new ConfigError("Invalid API key profile in credentials file.");
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
  locked = false,
): Promise<void> {
  const path = credentialsFilePath(env);
  if (!locked) return withCredentialsLock(env, () => writeCredentialsFile(path, session));
  await writeCredentialsFile(path, session);
}

export async function saveApiKeyProfile(
  profile: ApiKeyProfile,
  env: NodeJS.ProcessEnv = process.env,
  locked = false,
): Promise<void> {
  if (!profileName(env)) {
    throw new ConfigError("API key profiles require --profile <name> or LINEAR_PROFILE.");
  }
  const path = credentialsFilePath(env);
  if (!locked) return withCredentialsLock(env, () => writeCredentialsFile(path, profile));
  await writeCredentialsFile(path, profile);
}

export interface ProfileSummary {
  name: string;
  kind: StoredCredentials["kind"];
  organizationName?: string;
  organizationUrlKey?: string;
  expiresAt?: number;
}

export async function listProfiles(): Promise<ProfileSummary[]> {
  const { readdir } = await import("node:fs/promises");
  let files: string[];
  try {
    files = await readdir(PROFILES_DIR);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const profiles = await Promise.all(
    files
      .filter((file) => file.endsWith(".json"))
      .map(async (file): Promise<ProfileSummary | null> => {
        const name = file.slice(0, -5);
        if (!PROFILE_NAME.test(name)) return null;
        const env = { LINEAR_PROFILE: name } as NodeJS.ProcessEnv;
        const stored = await loadStoredCredentials(env);
        if (!stored) return null;
        const expiresAt = "expiresAt" in stored ? stored.expiresAt : undefined;
        const summary: ProfileSummary = {
          name,
          kind: stored.kind,
          organizationName: "organizationName" in stored ? stored.organizationName : undefined,
          organizationUrlKey:
            "organizationUrlKey" in stored ? stored.organizationUrlKey : undefined,
          expiresAt,
        };
        return summary;
      }),
  );
  return profiles
    .filter((profile): profile is ProfileSummary => profile !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
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

export async function renameProfile(oldName: string, newName: string): Promise<void> {
  const from = validateProfileName(oldName);
  const to = validateProfileName(newName);
  if (from === to) throw new ConfigError("The new profile name must be different.");

  const firstName = from.localeCompare(to) < 0 ? from : to;
  const secondName = firstName === from ? to : from;
  const lockEnv = (name: string) => ({ LINEAR_PROFILE: name }) as NodeJS.ProcessEnv;
  await withCredentialsLock(lockEnv(firstName), async () =>
    withCredentialsLock(lockEnv(secondName), async () => {
      const source = profilePath(from);
      const destination = profilePath(to);
      try {
        await stat(source);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          throw new ConfigError(`Profile \`${from}\` does not exist.`);
        }
        throw err;
      }
      try {
        await stat(destination);
        throw new ConfigError(`Profile \`${to}\` already exists.`);
      } catch (err) {
        if (err instanceof ConfigError) throw err;
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
      await rename(source, destination);
    }),
  );
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
    organizationName: existing?.organizationName,
    organizationUrlKey: existing?.organizationUrlKey,
  };
}
