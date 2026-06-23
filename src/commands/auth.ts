import { resolveCredential } from "../config.ts";
import { executeGraphql } from "../graphql/client.ts";
import { VIEWER_QUERY, type ViewerResult } from "../graphql/documents.ts";

export interface WhoamiData {
  user: { id: string; name: string; email: string };
  organization: { id: string; name: string; urlKey: string };
  credentialKind: "oauth" | "apiKey";
}

export async function whoami(opts: { debug?: boolean }): Promise<WhoamiData> {
  const credential = resolveCredential();
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
  };
}

export function formatWhoami(data: WhoamiData): string {
  return (
    `Authenticated as ${data.user.name} <${data.user.email}>\n` +
    `Organization: ${data.organization.name} (${data.organization.urlKey})\n` +
    `Credential: ${data.credentialKind === "oauth" ? "OAuth access token" : "personal API key"}`
  );
}
