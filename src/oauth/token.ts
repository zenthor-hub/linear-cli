import { ConfigError } from "../errors.ts";
import { LINEAR_OAUTH_REVOKE_URL, LINEAR_OAUTH_TOKEN_URL } from "./constants.ts";
import type { TokenResponse } from "./types.ts";

export interface TokenRequestOptions {
  clientId: string;
  clientSecret?: string;
  debug?: boolean;
}

async function postToken(
  body: URLSearchParams,
  options: TokenRequestOptions,
): Promise<TokenResponse> {
  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
  };

  if (options.clientSecret) {
    const basic = Buffer.from(`${options.clientId}:${options.clientSecret}`).toString("base64");
    headers.authorization = `Basic ${basic}`;
  }

  if (options.debug) {
    const safe = new URLSearchParams(body);
    for (const key of ["code", "refresh_token", "client_secret", "code_verifier"]) {
      if (safe.has(key)) safe.set(key, "[REDACTED]");
    }
    process.stderr.write(
      `[debug] POST ${LINEAR_OAUTH_TOKEN_URL}\n[debug] body ${safe.toString()}\n`,
    );
  }

  const response = await fetch(LINEAR_OAUTH_TOKEN_URL, {
    method: "POST",
    headers,
    body,
  });

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ConfigError(`OAuth token endpoint returned non-JSON (HTTP ${response.status}).`);
  }

  if (!response.ok) {
    const message =
      typeof payload === "object" &&
      payload !== null &&
      "error_description" in payload &&
      typeof (payload as { error_description: unknown }).error_description === "string"
        ? (payload as { error_description: string }).error_description
        : `OAuth token request failed (HTTP ${response.status}).`;
    throw new ConfigError(message);
  }

  const token = payload as TokenResponse;
  if (!token.access_token || !token.expires_in) {
    throw new ConfigError("OAuth token response missing access_token or expires_in.");
  }

  return token;
}

export async function exchangeAuthorizationCode(input: {
  code: string;
  redirectUri: string;
  codeVerifier: string;
  options: TokenRequestOptions;
}): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: input.options.clientId,
    code_verifier: input.codeVerifier,
  });
  if (input.options.clientSecret) {
    body.set("client_secret", input.options.clientSecret);
  }
  const token = await postToken(body, input.options);
  if (!token.refresh_token) {
    throw new ConfigError("OAuth token response missing refresh_token.");
  }
  return token;
}

export async function refreshAccessToken(input: {
  refreshToken: string;
  options: TokenRequestOptions;
}): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: input.refreshToken,
    client_id: input.options.clientId,
  });
  if (input.options.clientSecret) {
    body.set("client_secret", input.options.clientSecret);
  }
  const token = await postToken(body, input.options);
  if (!token.refresh_token) {
    throw new ConfigError("OAuth refresh response missing refresh_token.");
  }
  return token;
}

export async function fetchClientCredentialsToken(input: {
  scope: string;
  options: TokenRequestOptions;
}): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope: input.scope,
    client_id: input.options.clientId,
  });
  if (input.options.clientSecret) {
    body.set("client_secret", input.options.clientSecret);
  }
  return postToken(body, input.options);
}

export async function revokeToken(input: {
  token: string;
  tokenTypeHint?: "access_token" | "refresh_token";
  options: TokenRequestOptions;
}): Promise<void> {
  const body = new URLSearchParams({ token: input.token, client_id: input.options.clientId });
  if (input.tokenTypeHint) {
    body.set("token_type_hint", input.tokenTypeHint);
  }

  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
  };
  if (input.options.clientSecret) {
    const basic = Buffer.from(`${input.options.clientId}:${input.options.clientSecret}`).toString(
      "base64",
    );
    headers.authorization = `Basic ${basic}`;
  }

  const response = await fetch(LINEAR_OAUTH_REVOKE_URL, { method: "POST", headers, body });
  if (!response.ok) {
    throw new ConfigError(`OAuth token revocation failed (HTTP ${response.status}).`);
  }
}
