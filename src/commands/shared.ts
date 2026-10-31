import { readFile } from "node:fs/promises";

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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Linear slugIds are short lowercase hex strings (12 chars today). */
const SLUG_ID_RE = /^[0-9a-f]{8,32}$/i;

export interface LinearDocumentRef {
  /** Value accepted by `document(id:)`: a UUID or a slugId. */
  id: string;
  kind: "uuid" | "slugId" | "url";
  /** Workspace URL key when the ref was a linear.app URL. */
  workspace?: string;
}

/**
 * Parse a document reference: a linear.app document URL
 * (https://linear.app/<org>/document/<title-slug>-<slugId>), a bare slugId, or a UUID.
 */
export function parseDocumentRef(ref: string): LinearDocumentRef {
  const trimmed = ref.trim();
  if (!trimmed) throw new ConfigError("Document reference is required.");
  if (UUID_RE.test(trimmed)) return { id: trimmed.toLowerCase(), kind: "uuid" };
  if (SLUG_ID_RE.test(trimmed)) return { id: trimmed.toLowerCase(), kind: "slugId" };

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new ConfigError(
      `Unrecognized document reference: ${ref}. Use a linear.app document URL, a slugId, or a UUID.`,
    );
  }
  const segments = url.pathname.split("/").filter(Boolean);
  const docIndex = segments.indexOf("document");
  const slug = docIndex >= 0 ? segments[docIndex + 1] : undefined;
  if (url.hostname !== "linear.app" || docIndex !== 1 || !slug) {
    throw new ConfigError(
      `Not a Linear document URL: ${ref}. Expected https://linear.app/<workspace>/document/<title>-<slugId>.`,
    );
  }
  const slugId = slug.split("-").at(-1) ?? "";
  if (!SLUG_ID_RE.test(slugId)) {
    throw new ConfigError(`Could not find a document slugId at the end of the URL: ${ref}`);
  }
  return { id: slugId.toLowerCase(), kind: "url", workspace: segments[0] };
}

/**
 * Read text from an inline flag value or a file flag (`-` reads stdin).
 * Returns undefined when neither is set. Content is returned verbatim.
 */
export async function readTextInput(
  inline: string | undefined,
  file: string | undefined,
  flags: { inline: string; file: string },
  stdin: () => Promise<string> = readStdin,
): Promise<string | undefined> {
  if (inline !== undefined && file !== undefined) {
    throw new ConfigError(`Use either --${flags.inline} or --${flags.file}, not both.`);
  }
  if (file === undefined) return inline;
  if (file === "-") return stdin();
  return readFile(file, "utf8").catch(() => {
    throw new ConfigError(`Could not read --${flags.file}: ${file}`);
  });
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    throw new ConfigError("Expected content on stdin for `-`, but stdin is a terminal.");
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Validate an optional hex color flag (#0ea5e9 or #fff). */
export function parseHexColor(color: string | undefined, label: string): string | undefined {
  if (color === undefined) return undefined;
  const trimmed = color.trim();
  if (!HEX_COLOR_RE.test(trimmed)) {
    throw new ConfigError(`${label} --color must be a hex color like #0ea5e9 or #fff.`);
  }
  return trimmed;
}
