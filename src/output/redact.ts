const TOKEN_LIKE = /\blin_(?:api|oauth)_[A-Za-z0-9]+\b/g;
const BEARER = /\bBearer\s+[A-Za-z0-9._-]+/gi;

/**
 * Remove token-like values from arbitrary text before it is logged.
 *
 * Pass the active credential's raw value(s) via `secrets` so exact matches are
 * stripped even when they do not match the generic patterns.
 */
export function redactText(input: string, secrets: readonly string[] = []): string {
  let out = input;
  for (const secret of secrets) {
    if (secret && secret.length >= 4) {
      out = out.split(secret).join("[REDACTED]");
    }
  }
  out = out.replace(BEARER, "Bearer [REDACTED]");
  out = out.replace(TOKEN_LIKE, "[REDACTED]");
  return out;
}

/** Redact an outgoing headers object for `--debug` output. */
export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key] = key.toLowerCase() === "authorization" ? "[REDACTED]" : value;
  }
  return out;
}
