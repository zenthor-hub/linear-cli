export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
  refresh_token?: string;
}

export interface OAuthSession {
  kind: "oauth";
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope: string;
  tokenType: "Bearer";
  clientId: string;
  userId?: string;
  organizationId?: string;
}

export interface ClientCredentialsSession {
  kind: "client_credentials";
  accessToken: string;
  expiresAt: number;
  scope: string;
  tokenType: "Bearer";
  clientId: string;
}

export type StoredCredentials = OAuthSession | ClientCredentialsSession;

export type CredentialSource = "apiKey" | "accessToken" | "store" | "clientCredentials";
