import { resolveCredential } from "../config.ts";
import { ConfigError } from "../errors.ts";

/** Require exactly one match from a candidate list, or throw with the given message. */
export function singleMatch<T>(matches: T[], emptyMessage: string, ambiguousMessage: string): T {
  if (matches.length === 0) throw new ConfigError(emptyMessage);
  if (matches.length > 1) throw new ConfigError(ambiguousMessage);
  const match = matches[0];
  if (match === undefined) throw new ConfigError(emptyMessage);
  return match;
}

export async function credentialOptions(debug?: boolean) {
  return { credential: await resolveCredential(), debug };
}
