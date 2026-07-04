const TOKEN_LIKE = /\blin_(?:api|oauth)_[A-Za-z0-9]+\b/g;
const BEARER = /\bBearer\s+[A-Za-z0-9._-]+/gi;
const REFRESH_TOKEN = /\brefresh_token=[^&\s]+/gi;
const URL_LIKE = /\bhttps?:\/\/[^\s"'<>]+/gi;
const ENV_SECRET_ASSIGNMENT =
  /\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD)[A-Z0-9_]*)=(['"]?)[^&'"\s]+(['"]?)/g;
const URL_SECRET_PARAM_NAMES = new Set([
  "accesstoken",
  "apikey",
  "auth",
  "authorization",
  "clientsecret",
  "key",
  "password",
  "refreshtoken",
  "secret",
  "signature",
  "sig",
  "token",
]);
const SENSITIVE_AUDIT_FIELDS = new Set([
  "accesstoken",
  "apikey",
  "authorization",
  "clientsecret",
  "exporthint",
  "password",
  "refreshtoken",
  "secret",
  "token",
]);

function normalizeSecretKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isSensitiveUrlParam(key: string): boolean {
  const normalized = normalizeSecretKey(key);
  return URL_SECRET_PARAM_NAMES.has(normalized);
}

function isSensitiveAuditField(key: string): boolean {
  return SENSITIVE_AUDIT_FIELDS.has(normalizeSecretKey(key));
}

export function redactUrlSecrets(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return input;
  }

  if (url.username) url.username = "[REDACTED]";
  if (url.password) url.password = "[REDACTED]";
  for (const key of Array.from(url.searchParams.keys())) {
    if (isSensitiveUrlParam(key)) {
      url.searchParams.set(key, "[REDACTED]");
    }
  }

  return url.toString().replaceAll("%5BREDACTED%5D", "[REDACTED]");
}

function redactUrlsInText(input: string): string {
  return input.replace(URL_LIKE, (url) => redactUrlSecrets(url));
}

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
  out = out.replace(REFRESH_TOKEN, "refresh_token=[REDACTED]");
  out = out.replace(TOKEN_LIKE, "[REDACTED]");
  out = out.replace(ENV_SECRET_ASSIGNMENT, (_match, key: string, quote: string) => {
    return `${key}=${quote}[REDACTED]${quote}`;
  });
  out = redactUrlsInText(out);
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

export function redactForAudit(value: unknown): unknown {
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map((item) => redactForAudit(item));
  if (typeof value !== "object" || value === null) return value;

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = isSensitiveAuditField(key) ? "[REDACTED]" : redactForAudit(item);
  }
  return out;
}
