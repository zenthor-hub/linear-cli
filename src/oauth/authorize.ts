import { LINEAR_OAUTH_AUTHORIZE_URL } from "./constants.ts";

export function buildAuthorizeUrl(input: {
  clientId: string;
  redirectUri: string;
  scope: string;
  state: string;
  codeChallenge: string;
}): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    scope: input.scope,
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
  });
  return `${LINEAR_OAUTH_AUTHORIZE_URL}?${params.toString()}`;
}
