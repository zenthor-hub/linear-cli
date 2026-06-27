import { createHash, randomBytes } from "node:crypto";

const VERIFIER_LENGTH = 64;

function base64UrlEncode(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

/** Generate a PKCE code verifier (43–128 unreserved characters). */
export function generateCodeVerifier(
  random: () => Buffer = () => randomBytes(VERIFIER_LENGTH),
): string {
  return base64UrlEncode(random()).slice(0, VERIFIER_LENGTH);
}

/** S256 code challenge for a verifier. */
export function codeChallengeS256(verifier: string): string {
  return base64UrlEncode(createHash("sha256").update(verifier).digest());
}
