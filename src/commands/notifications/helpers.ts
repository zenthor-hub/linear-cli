import { resolveCredential } from "../../config.ts";
import { ConfigError } from "../../errors.ts";
import { NOTIFICATION_SUBSCRIPTION_TYPES, type NotificationSubscriptionType } from "./constants.ts";

export async function credentialOptions(debug?: boolean) {
  return { credential: await resolveCredential(), debug };
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function parseIsoTimestamp(value: string, flag: string): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new ConfigError(`${flag} must be a valid ISO-8601 timestamp.`);
  }
  return new Date(parsed).toISOString();
}

export function normalizeStringList(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return (Array.isArray(value) ? value : [value])
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/** Linear filter comparator for a non-empty list of exact values. */
export function eqOrIn(values: string[]): { eq: string } | { in: string[] } | undefined {
  const [first, ...rest] = values;
  if (first === undefined) return undefined;
  if (rest.length === 0) return { eq: first };
  return { in: values };
}

export function parseEnumValue<T extends string>(
  value: string,
  allowed: readonly T[],
  flag: string,
): T {
  if (allowed.includes(value as T)) return value as T;
  throw new ConfigError(`${flag} must be one of ${allowed.join(", ")}.`);
}

export function validateSubscriptionTypes(
  types: string[] | undefined,
  flag = "--type",
): string[] | undefined {
  if (!types?.length) return undefined;
  const invalid = types.filter(
    (type) => !NOTIFICATION_SUBSCRIPTION_TYPES.includes(type as NotificationSubscriptionType),
  );
  if (invalid.length > 0) {
    throw new ConfigError(
      `Invalid ${flag} value(s): ${invalid.join(", ")}. Expected one of ${NOTIFICATION_SUBSCRIPTION_TYPES.join(", ")}.`,
    );
  }
  return types;
}

/** Collapse newlines so multi-line text can't be mistaken for additional output fields. */
export function singleLine(text: string): string {
  return text.replace(/\s*\r?\n\s*/g, " ").trim();
}

export function truncateForDisplay(text: string, maxChars: number): string {
  const chars = Array.from(text);
  if (chars.length <= maxChars) return text;
  return `${chars.slice(0, Math.max(0, maxChars - 1)).join("")}…`;
}

/**
 * Require exactly one of the provided named selectors to be set.
 * Returns the winning key and its value.
 */
export function requireExactlyOne<T extends string>(
  selectors: Partial<Record<T, string | undefined>>,
  emptyMessage: string,
  multiMessage: string,
): { key: T; value: string } {
  const selected = (Object.entries(selectors) as [T, string | undefined][]).filter(
    (entry): entry is [T, string] => Boolean(entry[1]),
  );
  if (selected.length === 0) throw new ConfigError(emptyMessage);
  if (selected.length > 1) throw new ConfigError(multiMessage);
  const winner = selected[0];
  if (!winner) throw new ConfigError(emptyMessage);
  const [key, value] = winner;
  return { key, value };
}
