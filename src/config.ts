import { ConfigError } from "./errors.ts";
import { REFRESH_SKEW_MS } from "./oauth/constants.ts";
import {
  beginStoredCredentialLogout,
  cancelStoredCredentialLogout,
  clearStoredCredentials,
  commitStoredCredentialLogout,
  credentialsFilePath,
  listProfiles,
  loadStoredCredentials,
  profileName,
  renameProfile,
  saveApiKeyProfile,
  saveOAuthSession,
  sessionFromTokenResponse,
  updateStoredCredentials,
} from "./oauth/store.ts";
import { fetchClientCredentialsToken, refreshAccessToken } from "./oauth/token.ts";
import type { ClientCredentialsSession, CredentialSource, OAuthSession } from "./oauth/types.ts";

export const LINEAR_GRAPHQL_ENDPOINT = "https://api.linear.app/graphql";

export type CredentialKind = "oauth" | "apiKey";

export interface Credential {
  kind: CredentialKind;
  /** Exact value for the `Authorization` request header. */
  authorizationHeader: string;
  /** Raw secret value, kept only for redaction matching. Never log this. */
  raw: string;
  /** Where this credential came from. */
  source: CredentialSource;
  /** Selected named profile, if any; used to refresh the same credential source after a 401. */
  profile?: string;
}

export interface ResolveCredentialOptions {
  forceRefresh?: boolean;
  env?: NodeJS.ProcessEnv;
}

let clientCredentialsCache: ClientCredentialsSession | null = null;
const refreshPromises = new Map<string, Promise<OAuthSession>>();

function envCredential(env: NodeJS.ProcessEnv): Credential | null {
  const token = env.LINEAR_ACCESS_TOKEN?.trim() || undefined;
  const apiKey = env.LINEAR_API_KEY?.trim() || undefined;

  if (token && apiKey) {
    throw new ConfigError(
      "Both LINEAR_ACCESS_TOKEN and LINEAR_API_KEY are set. Provide exactly one credential.",
    );
  }

  if (token) {
    return {
      kind: "oauth",
      authorizationHeader: `Bearer ${token}`,
      raw: token,
      source: "accessToken",
    };
  }

  if (apiKey) {
    return {
      kind: "apiKey",
      authorizationHeader: apiKey,
      raw: apiKey,
      source: "apiKey",
    };
  }

  return null;
}

function assertProfileSelectionIsUnambiguous(env: NodeJS.ProcessEnv): void {
  if (!profileName(env)) return;
  if (
    env.LINEAR_API_KEY?.trim() ||
    env.LINEAR_ACCESS_TOKEN?.trim() ||
    env.LINEAR_CREDENTIALS_FILE?.trim()
  ) {
    throw new ConfigError(
      "A selected profile cannot be combined with LINEAR_API_KEY, LINEAR_ACCESS_TOKEN, or LINEAR_CREDENTIALS_FILE.",
    );
  }
}

function oauthCredentialFromSession(session: OAuthSession | ClientCredentialsSession): Credential {
  return {
    kind: "oauth",
    authorizationHeader: `Bearer ${session.accessToken}`,
    raw: session.accessToken,
    source: session.kind === "oauth" ? "store" : "clientCredentials",
  };
}

function withProfile(credential: Credential, env: NodeJS.ProcessEnv): Credential {
  const profile = profileName(env);
  return profile ? { ...credential, profile } : credential;
}

function tokenRequestOptions(env: NodeJS.ProcessEnv) {
  const clientId = env.LINEAR_CLIENT_ID?.trim();
  const clientSecret = env.LINEAR_CLIENT_SECRET?.trim() || undefined;
  if (!clientId) {
    throw new ConfigError("LINEAR_CLIENT_ID is required for OAuth session refresh.");
  }
  return { clientId, clientSecret };
}

function sessionNeedsRefresh(session: OAuthSession, forceRefresh: boolean): boolean {
  if (forceRefresh) return true;
  return session.expiresAt - Date.now() <= REFRESH_SKEW_MS;
}

async function refreshStoredSession(
  session: OAuthSession,
  env: NodeJS.ProcessEnv,
  forceRefresh: boolean,
): Promise<OAuthSession> {
  if (!sessionNeedsRefresh(session, forceRefresh)) {
    return session;
  }

  const key = credentialsFilePath(env);
  const existing = refreshPromises.get(key);
  if (existing) return existing;

  const refreshPromise = updateStoredCredentials(env, async (store) => {
    const latest = store.current;
    if (!latest) {
      throw new ConfigError("Stored credentials were removed while refresh was waiting.");
    }
    if (latest.kind !== "oauth") {
      throw new ConfigError("Stored credentials changed while refresh was waiting.");
    }
    if (latest?.kind === "oauth" && latest.refreshToken !== session.refreshToken) {
      return latest;
    }
    const current = latest;
    const token = await refreshAccessToken({
      refreshToken: current.refreshToken,
      options: tokenRequestOptions(env),
    });
    const updated = sessionFromTokenResponse(token, current.clientId, current);
    await store.save(updated);
    return updated;
  });
  refreshPromises.set(key, refreshPromise);

  try {
    return await refreshPromise;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ConfigError(`${message} Re-run \`linear auth login\` to authenticate again.`);
  } finally {
    if (refreshPromises.get(key) === refreshPromise) refreshPromises.delete(key);
  }
}

async function resolveClientCredentials(
  env: NodeJS.ProcessEnv,
  forceRefresh = false,
): Promise<Credential> {
  const grant = env.LINEAR_OAUTH_GRANT?.trim();
  if (grant !== "client_credentials") {
    throw new ConfigError(
      "No Linear credential found. Run `linear auth login`, or set LINEAR_API_KEY / LINEAR_ACCESS_TOKEN.",
    );
  }

  const clientId = env.LINEAR_CLIENT_ID?.trim();
  const clientSecret = env.LINEAR_CLIENT_SECRET?.trim();
  const scope = env.LINEAR_OAUTH_SCOPE?.trim();
  if (!clientId || !clientSecret || !scope) {
    throw new ConfigError(
      "Client credentials require LINEAR_CLIENT_ID, LINEAR_CLIENT_SECRET, and LINEAR_OAUTH_SCOPE.",
    );
  }

  if (
    !forceRefresh &&
    clientCredentialsCache &&
    clientCredentialsCache.clientId === clientId &&
    clientCredentialsCache.scope === scope &&
    clientCredentialsCache.expiresAt - Date.now() > REFRESH_SKEW_MS
  ) {
    return oauthCredentialFromSession(clientCredentialsCache);
  }

  if (forceRefresh) {
    clientCredentialsCache = null;
  }

  const token = await fetchClientCredentialsToken({
    scope,
    options: { clientId, clientSecret },
  });

  clientCredentialsCache = {
    kind: "client_credentials",
    accessToken: token.access_token,
    expiresAt: Date.now() + token.expires_in * 1000,
    scope: token.scope,
    tokenType: "Bearer",
    clientId,
  };

  return oauthCredentialFromSession(clientCredentialsCache);
}

async function resolveStoredCredential(
  env: NodeJS.ProcessEnv,
  forceRefresh: boolean,
): Promise<Credential | null> {
  const stored = await loadStoredCredentials(env);
  if (!stored) return null;

  if (stored.kind === "apiKey") {
    return withProfile(
      {
        kind: "apiKey",
        authorizationHeader: stored.apiKey,
        raw: stored.apiKey,
        source: "store",
      },
      env,
    );
  }

  if (stored.kind === "client_credentials") {
    return withProfile(oauthCredentialFromSession(stored), env);
  }

  const refreshed = await refreshStoredSession(stored, env, forceRefresh);
  return withProfile(oauthCredentialFromSession(refreshed), env);
}

/**
 * Resolve the active request credential.
 *
 * Precedence:
 * 1. LINEAR_API_KEY
 * 2. LINEAR_ACCESS_TOKEN
 * 3. Stored OAuth session (auto-refresh)
 * 4. LINEAR_OAUTH_GRANT=client_credentials env vars
 */
export async function resolveCredential(
  options: ResolveCredentialOptions = {},
): Promise<Credential> {
  const env = options.env ?? process.env;
  assertProfileSelectionIsUnambiguous(env);
  if (profileName(env)) {
    const profileCredential = await resolveStoredCredential(env, options.forceRefresh ?? false);
    if (profileCredential) return profileCredential;
    throw new ConfigError(`No credentials found for profile \`${profileName(env)}\`.`);
  }
  const fromEnv = envCredential(env);
  if (fromEnv) return fromEnv;

  const fromStore = await resolveStoredCredential(env, options.forceRefresh ?? false);
  if (fromStore) return fromStore;

  return resolveClientCredentials(env, options.forceRefresh ?? false);
}

/** Path to the on-disk OAuth session file, if configured. */
export {
  beginStoredCredentialLogout,
  cancelStoredCredentialLogout,
  commitStoredCredentialLogout,
  credentialsFilePath,
  clearStoredCredentials,
  listProfiles,
  renameProfile,
  saveApiKeyProfile,
  saveOAuthSession,
  sessionFromTokenResponse,
};
export type { OAuthSession, CredentialSource };
