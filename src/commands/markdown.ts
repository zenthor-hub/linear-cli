import { ConfigError } from "../errors.ts";

/**
 * Markdown section helpers for Linear document content.
 *
 * A section is an ATX heading line (`#`..`######`) through to the line before
 * the next heading of the same or higher level (fewer or equal `#`), or the end
 * of the document. Headings inside fenced code blocks are ignored. Setext
 * headings (underlined with === / ---) are not recognised; Linear emits ATX.
 */

export interface MarkdownHeading {
  level: number;
  /** Heading text without the leading #s, closing #s, or surrounding whitespace. */
  text: string;
  /** 0-based line index of the heading line. */
  line: number;
}

export interface MarkdownSection {
  heading: MarkdownHeading;
  /** 0-based line index of the heading (inclusive). */
  start: number;
  /** 0-based line index after the section's last line (exclusive). */
  end: number;
  /** Section markdown (heading through body), trailing blank lines trimmed. */
  content: string;
}

const ATX_HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

function stripClosingHashes(text: string): string {
  // "## Title ##" -> "Title"; a lone "#" run is the whole heading text otherwise.
  return text.replace(/(?:^|[ \t]+)#+[ \t]*$/, "").trim();
}

export function listHeadings(content: string): MarkdownHeading[] {
  const headings: MarkdownHeading[] = [];
  const lines = content.split("\n");
  let fence: string | undefined;
  for (const [index, raw] of lines.entries()) {
    const line = raw.replace(/\r$/, "");
    const fenceMatch = FENCE.exec(line);
    if (fenceMatch?.[1]) {
      const marker = fenceMatch[1];
      if (fence === undefined) {
        fence = marker;
      } else if (marker[0] === fence[0] && marker.length >= fence.length) {
        fence = undefined;
      }
      continue;
    }
    if (fence !== undefined) continue;
    const match = ATX_HEADING.exec(line);
    if (!match?.[1]) continue;
    headings.push({
      level: match[1].length,
      text: stripClosingHashes(match[2] ?? ""),
      line: index,
    });
  }
  return headings;
}

function normalizeHeadingText(text: string): string {
  return text.replace(/[*_`]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Find exactly one heading matching `query`.
 *
 * Matching is case-insensitive and ignores `*`, `_`, and backtick emphasis.
 * An exact heading-text match wins; otherwise the query must appear in the
 * heading as a whole token (so "EST-006" matches "EST-006 — assign reviewer"
 * but not "EST-0061"). Leading `#`s in the query are ignored.
 */
export function findHeading(content: string, query: string): MarkdownHeading {
  const needle = normalizeHeadingText(query.replace(/^\s*#+\s*/, ""));
  if (!needle) throw new ConfigError("--section requires heading text.");
  const headings = listHeadings(content);

  const exact = headings.filter((h) => normalizeHeadingText(h.text) === needle);
  const token = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(needle)}($|[^\\p{L}\\p{N}])`, "u");
  const matches =
    exact.length > 0 ? exact : headings.filter((h) => token.test(normalizeHeadingText(h.text)));

  if (matches.length === 0) {
    throw new ConfigError(
      `No section heading matches "${query}" (${headings.length} headings in document).`,
    );
  }
  if (matches.length > 1) {
    const listed = matches
      .slice(0, 10)
      .map((h) => `  line ${h.line + 1}: ${"#".repeat(h.level)} ${h.text}`)
      .join("\n");
    const more = matches.length > 10 ? `\n  …and ${matches.length - 10} more` : "";
    throw new ConfigError(
      `Section "${query}" is ambiguous; ${matches.length} headings match:\n${listed}${more}\nUse more of the heading text.`,
    );
  }
  return matches[0] as MarkdownHeading;
}

export function findSection(content: string, query: string): MarkdownSection {
  const heading = findHeading(content, query);
  const lines = content.split("\n");
  const next = listHeadings(content).find((h) => h.line > heading.line && h.level <= heading.level);
  const end = next ? next.line : lines.length;
  let last = end;
  while (last > heading.line + 1 && (lines[last - 1] ?? "").trim() === "") last -= 1;
  return {
    heading,
    start: heading.line,
    end,
    content: lines.slice(heading.line, last).join("\n"),
  };
}

/**
 * Replace one section (heading line included) with `replacement`.
 *
 * The replacement must itself start with a heading line so a section can never
 * silently lose its heading. One blank line separates it from the next section.
 */
export function replaceSection(content: string, query: string, replacement: string): string {
  const section = findSection(content, query);
  const body = replacement.replace(/\s+$/, "");
  const firstLine = body.split("\n").find((line) => line.trim() !== "") ?? "";
  if (!ATX_HEADING.test(firstLine)) {
    throw new ConfigError(
      `Section replacement must start with a markdown heading: the replaced range includes the heading line "${"#".repeat(section.heading.level)} ${section.heading.text}".`,
    );
  }
  const lines = content.split("\n");
  const before = lines.slice(0, section.start);
  const after = lines.slice(section.end);
  const replaced = body.split("\n");
  if (after.length > 0) replaced.push("");
  return [...before, ...replaced, ...after].join("\n");
}

/** Append markdown to the end of a document, separated by one blank line. */
export function appendContent(content: string, addition: string): string {
  const extra = addition.replace(/\s+$/, "");
  if (!extra.trim()) throw new ConfigError("--append-file content is empty.");
  const existing = content.replace(/\s+$/, "");
  return existing ? `${existing}\n\n${extra}` : extra;
}
