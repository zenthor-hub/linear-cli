import { ConfigError } from "./errors.ts";

export const LINEAR_GRAPHQL_ENDPOINT = "https://api.linear.app/graphql";

export type CredentialKind = "oauth" | "apiKey";

export interface Credential {
  kind: CredentialKind;
  /** Exact value for the `Authorization` request header. */
  authorizationHeader: string;
  /** Raw secret value, kept only for redaction matching. Never log this. */
  raw: string;
}

/**
 * Resolve the single request credential from the environment.
 *
 * Decision (see implementation.md "Resolved Decisions"): setting BOTH
 * LINEAR_ACCESS_TOKEN and LINEAR_API_KEY is rejected as ambiguous rather than
 * silently preferring one — this avoids acting under the wrong identity.
 */
export function resolveCredential(env: NodeJS.ProcessEnv = process.env): Credential {
  const token = env.LINEAR_ACCESS_TOKEN?.trim() || undefined;
  const apiKey = env.LINEAR_API_KEY?.trim() || undefined;

  if (token && apiKey) {
    throw new ConfigError(
      "Both LINEAR_ACCESS_TOKEN and LINEAR_API_KEY are set. Provide exactly one credential.",
    );
  }

  if (token) {
    return { kind: "oauth", authorizationHeader: `Bearer ${token}`, raw: token };
  }

  if (apiKey) {
    return { kind: "apiKey", authorizationHeader: apiKey, raw: apiKey };
  }

  throw new ConfigError(
    "No Linear credential found. Set LINEAR_ACCESS_TOKEN (OAuth) or LINEAR_API_KEY (personal API key).",
  );
}
