import { ConfigError, ConflictError, LinearGraphqlError } from "../errors.ts";
import { executeGraphql } from "../graphql/client.ts";
import {
  COMMENT_THREAD_QUERY,
  DOCUMENT_COMMENT_CREATE,
  DOCUMENT_COMMENTS_QUERY,
  DOCUMENT_CREATE,
  DOCUMENT_DELETE,
  DOCUMENT_QUERY,
  DOCUMENT_REFERENCE_QUERY,
  DOCUMENT_UNARCHIVE,
  DOCUMENT_UPDATE,
  DOCUMENTS_QUERY,
  SEARCH_DOCUMENTS_QUERY,
  type CommentThreadResult,
  type Document,
  type DocumentComment,
  type DocumentCommentCreateInput,
  type DocumentCommentCreateResult,
  type DocumentCommentsResult,
  type DocumentCreateInput,
  type DocumentCreateResult,
  type DocumentDeleteResult,
  type DocumentReference,
  type DocumentReferenceResult,
  type DocumentResult,
  type DocumentsResult,
  type DocumentUnarchiveResult,
  type DocumentUpdateInput,
  type DocumentUpdateResult,
  type SearchDocumentsResult,
} from "../graphql/documents.ts";
import { fetchNodes } from "../graphql/paginate.ts";
import { unifiedDiff } from "../output/diff.ts";
import { parsePositiveLimit } from "./issues.ts";
import { appendContent, findSection, replaceSection } from "./markdown.ts";
import { resolveProjectReference } from "./projects.ts";
import {
  credentialOptions,
  parseDocumentRef,
  parseHexColor,
  readTextInput,
  type LinearDocumentRef,
} from "./shared.ts";
import { resolveTeam } from "./teams.ts";

export const DEFAULT_DOC_LIST_LIMIT = 20;
export const DEFAULT_DOC_COMMENTS_LIMIT = 50;
/** Linear caps `first` at 250; 50 keeps content-bearing search pages small. */
const MAX_PAGE_SIZE = 50;
/** `doc search --project` filters client-side; scan at most this many result pages. */
const SEARCH_PROJECT_SCAN_PAGES = 4;
const EXCERPT_RADIUS = 100;

export interface DocCommandOptions {
  debug?: boolean;
}

type PlannedChanges = Record<string, { from: unknown; to: unknown }>;

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

function isEntityNotFound(err: unknown): boolean {
  return (
    err instanceof LinearGraphqlError &&
    err.errors.some((e) => /^Entity not found/i.test(e.message))
  );
}

function notFound(ref: string, parsed: LinearDocumentRef): ConfigError {
  const hint = parsed.workspace
    ? ` (URL is for workspace "${parsed.workspace}"; check that --profile points at it)`
    : "";
  return new ConfigError(`No document found for: ${ref}${hint}`);
}

async function fetchDocument<T extends { document: unknown }>(
  query: string,
  ref: string,
  options: DocCommandOptions,
): Promise<T["document"]> {
  const parsed = parseDocumentRef(ref);
  try {
    const data = await executeGraphql<T>(
      query,
      { id: parsed.id },
      await credentialOptions(options.debug),
    );
    if (!data.document) throw notFound(ref, parsed);
    return data.document;
  } catch (err) {
    if (isEntityNotFound(err)) throw notFound(ref, parsed);
    throw err;
  }
}

/** Fetch a document with its markdown content. */
export async function fetchFullDocument(
  ref: string,
  options: DocCommandOptions = {},
): Promise<Document> {
  return fetchDocument<DocumentResult>(DOCUMENT_QUERY, ref, options);
}

/** Fetch document metadata without content. */
export async function resolveDocument(
  ref: string,
  options: DocCommandOptions = {},
): Promise<DocumentReference> {
  return fetchDocument<DocumentReferenceResult>(DOCUMENT_REFERENCE_QUERY, ref, options);
}

function withoutContent(document: Document): DocumentReference {
  const { content: _content, ...reference } = document;
  return reference;
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export interface DocSection {
  heading: string;
  level: number;
  /** 1-based line of the heading in the document content. */
  line: number;
  content: string;
}

export type DocGetData = Document | (DocumentReference & { section: DocSection });

export async function getDocument(
  ref: string,
  options: DocCommandOptions & { section?: string } = {},
): Promise<DocGetData> {
  const document = await fetchFullDocument(ref, options);
  if (options.section === undefined) return document;
  const section = findSection(document.content ?? "", options.section);
  return {
    ...withoutContent(document),
    section: {
      heading: section.heading.text,
      level: section.heading.level,
      line: section.heading.line + 1,
      content: section.content,
    },
  };
}

export interface DocListOptions extends DocCommandOptions {
  project?: string;
  team?: string;
  limit?: number;
  includeArchived?: boolean;
}

async function resolveContainerFilter(
  options: DocListOptions,
): Promise<{ projectId?: string; teamId?: string }> {
  if (options.project !== undefined && options.team !== undefined) {
    throw new ConfigError("Use either --project or --team, not both.");
  }
  if (options.project !== undefined) {
    const project = await resolveProjectReference(options.project, {
      debug: options.debug,
      includeArchived: options.includeArchived,
    });
    return { projectId: project.id };
  }
  if (options.team !== undefined) {
    const team = await resolveTeam(options.team, options);
    return { teamId: team.id };
  }
  return {};
}

/** List document metadata (no content), most recently updated first. */
export async function listDocuments(options: DocListOptions = {}): Promise<DocumentReference[]> {
  const limit = parsePositiveLimit(options.limit, DEFAULT_DOC_LIST_LIMIT) ?? DEFAULT_DOC_LIST_LIMIT;
  const { projectId, teamId } = await resolveContainerFilter(options);
  const filter = projectId
    ? { project: { id: { eq: projectId } } }
    : teamId
      ? { team: { id: { eq: teamId } } }
      : undefined;
  return fetchNodes<DocumentReference, DocumentsResult>(
    DOCUMENTS_QUERY,
    (data) => data.documents,
    await credentialOptions(options.debug),
    {
      first: Math.min(limit, MAX_PAGE_SIZE),
      filter,
      includeArchived: options.includeArchived ?? false,
    },
    { limit },
  );
}

export type DocSearchHit = DocumentReference & { excerpt: string };

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** A short single-line excerpt around the first match of the term (or its words). */
export function buildExcerpt(content: string | null, term: string): string {
  const text = collapse(content ?? "");
  if (!text) return "";
  const lower = text.toLowerCase();
  const needles = [
    term.toLowerCase(),
    ...term
      .toLowerCase()
      .split(/\s+/)
      .filter((word) => word.length >= 3),
  ];
  let index = -1;
  for (const needle of needles) {
    index = lower.indexOf(needle);
    if (index >= 0) break;
  }
  const start = Math.max(0, index < 0 ? 0 : index - EXCERPT_RADIUS / 2);
  const end = Math.min(text.length, start + EXCERPT_RADIUS * 2);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

/**
 * Full-text search over document titles and content (Linear `searchDocuments`).
 * `searchDocuments` has no container filter (its `teamId` argument only boosts
 * ranking), so `--project` and `--team` are filtered client-side over at most
 * SEARCH_PROJECT_SCAN_PAGES result pages. `--team` is also sent as the boost.
 */
export async function searchDocuments(
  text: string,
  options: DocListOptions = {},
): Promise<DocSearchHit[]> {
  const term = text.trim();
  if (!term) throw new ConfigError("Search text is required.");
  const limit = parsePositiveLimit(options.limit, DEFAULT_DOC_LIST_LIMIT) ?? DEFAULT_DOC_LIST_LIMIT;
  const { projectId, teamId } = await resolveContainerFilter(options);
  const match = projectId
    ? (node: Document) => node.project?.id === projectId
    : teamId
      ? (node: Document) => node.team?.id === teamId
      : undefined;

  const nodes = await fetchNodes<Document, SearchDocumentsResult>(
    SEARCH_DOCUMENTS_QUERY,
    (data) => data.searchDocuments,
    await credentialOptions(options.debug),
    {
      term,
      first: match ? MAX_PAGE_SIZE : Math.min(limit, MAX_PAGE_SIZE),
      includeArchived: options.includeArchived ?? false,
      ...(teamId ? { teamId } : {}),
    },
    {
      limit,
      ...(match
        ? { match, maxPages: SEARCH_PROJECT_SCAN_PAGES }
        : { maxPages: Math.ceil(limit / MAX_PAGE_SIZE) }),
    },
  );
  return nodes.map((node) => ({
    ...withoutContent(node),
    excerpt: buildExcerpt(node.content, term),
  }));
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

export interface DocCreateOptions extends DocCommandOptions {
  title: string;
  project?: string;
  team?: string;
  content?: string;
  contentFile?: string;
  icon?: string;
  color?: string;
  apply?: boolean;
}

export interface DocCreateData {
  applied: boolean;
  input: DocumentCreateInput;
  result?: DocumentReference;
}

function parseIcon(icon: string | undefined): string | undefined {
  if (icon === undefined) return undefined;
  const trimmed = icon.trim();
  if (!trimmed) throw new ConfigError("--icon cannot be empty.");
  return trimmed;
}

export async function createDocument(options: DocCreateOptions): Promise<DocCreateData> {
  const title = options.title.trim();
  if (!title) throw new ConfigError("Document --title is required.");
  const color = parseHexColor(options.color, "Document");
  const icon = parseIcon(options.icon);
  const content = await readTextInput(options.content, options.contentFile, {
    inline: "content",
    file: "content-file",
  });
  const { projectId, teamId } = await resolveContainerFilter(options);

  const input: DocumentCreateInput = { title };
  if (content !== undefined) input.content = content;
  if (projectId) input.projectId = projectId;
  if (teamId) input.teamId = teamId;
  if (icon !== undefined) input.icon = icon;
  if (color !== undefined) input.color = color;

  if (!options.apply) return { applied: false, input };

  const result = await executeGraphql<DocumentCreateResult>(
    DOCUMENT_CREATE,
    { input },
    await credentialOptions(options.debug),
  );
  if (!result.documentCreate.success) {
    throw new ConfigError("Linear reported the document was not created.");
  }
  return { applied: true, input, result: result.documentCreate.document };
}

export interface DocUpdateOptions extends DocCommandOptions {
  title?: string;
  project?: string;
  icon?: string;
  color?: string;
  content?: string;
  contentFile?: string;
  section?: string;
  appendFile?: string;
  /** Refuse unless the document's current updatedAt equals this value. */
  expectUpdatedAt?: string;
  apply?: boolean;
}

export type DocContentMode = "replace" | "section" | "append";

export interface DocContentChange {
  mode: DocContentMode;
  section?: string;
  diff: string;
  beforeLength: number;
  afterLength: number;
}

export interface DocUpdateData {
  applied: boolean;
  document: DocumentReference;
  /** The document's updatedAt when it was read; pass to --expect-updated-at. */
  readUpdatedAt: string;
  input: DocumentUpdateInput;
  plannedChanges: PlannedChanges;
  contentChange?: DocContentChange;
  result?: DocumentReference;
}

function setChange(
  input: Record<string, unknown>,
  planned: PlannedChanges,
  field: string,
  from: unknown,
  to: unknown,
  label = field,
): void {
  if (to === undefined || Object.is(from, to)) return;
  input[field] = to;
  planned[label] = { from, to };
}

async function planContent(
  current: string,
  options: DocUpdateOptions,
): Promise<{ mode: DocContentMode; next: string } | undefined> {
  const replacement = await readTextInput(options.content, options.contentFile, {
    inline: "content",
    file: "content-file",
  });
  if (options.appendFile !== undefined) {
    if (replacement !== undefined || options.section !== undefined) {
      throw new ConfigError(
        "--append-file cannot be combined with --content/--content-file/--section.",
      );
    }
    const addition = await readTextInput(undefined, options.appendFile, {
      inline: "append",
      file: "append-file",
    });
    return { mode: "append", next: appendContent(current, addition ?? "") };
  }
  if (options.section !== undefined) {
    if (replacement === undefined) {
      throw new ConfigError(
        "--section on doc update needs --content or --content-file with the replacement section. Use `doc get --section` to read one.",
      );
    }
    return { mode: "section", next: replaceSection(current, options.section, replacement) };
  }
  if (replacement !== undefined) return { mode: "replace", next: replacement };
  return undefined;
}

function assertNotStale(
  document: { updatedAt: string; title: string; slugId: string },
  expected: string,
  phase: string,
): void {
  if (document.updatedAt === expected) return;
  throw new ConflictError(
    `Document "${document.title}" (${document.slugId}) changed ${phase}: expected updatedAt ${expected}, found ${document.updatedAt}. Nothing was written. Re-read it (doc get) and redo the edit.`,
    expected,
    document.updatedAt,
  );
}

/**
 * Update document metadata and/or content. Dry-run unless apply is true.
 *
 * Stale-write guard for content edits:
 *  - `--apply` requires `--expect-updated-at` (the `readUpdatedAt` from the dry
 *    run), so the applied edit is anchored to the version the diff was reviewed
 *    against; a human edit since then makes the command refuse.
 *  - Immediately before the mutation the document is re-read and compared again
 *    (updatedAt and content). Linear has no conditional write, so a concurrent
 *    edit in the milliseconds between that re-read and the mutation cannot be
 *    excluded.
 */
export async function updateDocument(
  ref: string,
  options: DocUpdateOptions = {},
): Promise<DocUpdateData> {
  if (options.title !== undefined && !options.title.trim()) {
    throw new ConfigError("Document --title cannot be empty.");
  }
  const color = parseHexColor(options.color, "Document");
  const icon = parseIcon(options.icon);
  const expected = options.expectUpdatedAt?.trim();
  if (options.expectUpdatedAt !== undefined && !expected) {
    throw new ConfigError("--expect-updated-at cannot be empty.");
  }

  const document = await fetchFullDocument(ref, options);
  if (expected !== undefined) assertNotStale(document, expected, "since it was read");

  const current = document.content ?? "";
  const content = await planContent(current, options);
  const project =
    options.project !== undefined
      ? await resolveProjectReference(options.project, { debug: options.debug })
      : undefined;

  const input: Record<string, unknown> = {};
  const plannedChanges: PlannedChanges = {};
  setChange(input, plannedChanges, "title", document.title, options.title?.trim());
  if (project && project.id !== document.project?.id) {
    input.projectId = project.id;
    plannedChanges.project = { from: document.project?.name ?? null, to: project.name };
  }
  setChange(input, plannedChanges, "icon", document.icon, icon);
  setChange(input, plannedChanges, "color", document.color, color);

  let contentChange: DocContentChange | undefined;
  if (content && content.next !== current) {
    input.content = content.next;
    contentChange = {
      mode: content.mode,
      ...(options.section !== undefined ? { section: options.section } : {}),
      diff: unifiedDiff(current, content.next, {
        from: `a/${document.slugId} (updatedAt ${document.updatedAt})`,
        to: `b/${document.slugId}`,
      }),
      beforeLength: current.length,
      afterLength: content.next.length,
    };
    plannedChanges.content = {
      from: `${current.length} chars`,
      to: `${content.next.length} chars (${content.mode})`,
    };
  }

  const base = {
    document: withoutContent(document),
    readUpdatedAt: document.updatedAt,
    input: input as DocumentUpdateInput,
    plannedChanges,
    ...(contentChange ? { contentChange } : {}),
  };
  if (Object.keys(input).length === 0 || !options.apply) return { applied: false, ...base };

  if (contentChange) {
    if (expected === undefined) {
      throw new ConfigError(
        "Content edits with --apply need --expect-updated-at <readUpdatedAt from the dry run>, so the write is tied to the version you reviewed.",
      );
    }
    const fresh = await fetchFullDocument(document.id, options);
    assertNotStale(fresh, document.updatedAt, "while the edit was being prepared");
    if ((fresh.content ?? "") !== current) {
      throw new ConflictError(
        `Document "${document.title}" content changed while the edit was being prepared. Nothing was written.`,
        document.updatedAt,
        fresh.updatedAt,
      );
    }
  }

  const result = await executeGraphql<DocumentUpdateResult>(
    DOCUMENT_UPDATE,
    { id: document.id, input },
    await credentialOptions(options.debug),
  );
  if (!result.documentUpdate.success) {
    throw new ConfigError("Linear reported the document was not updated.");
  }
  return { applied: true, ...base, result: result.documentUpdate.document };
}

export interface DocTrashData {
  applied: boolean;
  document: DocumentReference;
  mutation: "documentDelete" | "documentUnarchive";
  variables: { id: string };
  /** True when the document was already in the requested state; nothing to do. */
  noop: boolean;
  result?: DocumentReference | null;
}

function isInTrash(document: DocumentReference): boolean {
  return document.trashed === true || document.archivedAt !== null;
}

/** Move a document to Linear's trash (restorable). Never a permanent delete. */
export async function archiveDocument(
  ref: string,
  options: DocCommandOptions & { apply?: boolean } = {},
): Promise<DocTrashData> {
  const document = await resolveDocument(ref, options);
  const plan = {
    document,
    mutation: "documentDelete" as const,
    variables: { id: document.id },
    noop: isInTrash(document),
  };
  if (plan.noop || !options.apply) return { applied: false, ...plan };

  const result = await executeGraphql<DocumentDeleteResult>(
    DOCUMENT_DELETE,
    plan.variables,
    await credentialOptions(options.debug),
  );
  if (!result.documentDelete.success) {
    throw new ConfigError("Linear reported the document was not moved to trash.");
  }
  return { applied: true, ...plan, result: result.documentDelete.entity };
}

/** Restore a trashed/archived document. */
export async function restoreDocument(
  ref: string,
  options: DocCommandOptions & { apply?: boolean } = {},
): Promise<DocTrashData> {
  const document = await resolveDocument(ref, options);
  const plan = {
    document,
    mutation: "documentUnarchive" as const,
    variables: { id: document.id },
    noop: !isInTrash(document),
  };
  if (plan.noop || !options.apply) return { applied: false, ...plan };

  const result = await executeGraphql<DocumentUnarchiveResult>(
    DOCUMENT_UNARCHIVE,
    plan.variables,
    await credentialOptions(options.debug),
  );
  if (!result.documentUnarchive.success) {
    throw new ConfigError("Linear reported the document was not restored.");
  }
  return { applied: true, ...plan, result: result.documentUnarchive.entity };
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

export interface DocCommentsData {
  document: DocumentReference;
  comments: DocumentComment[];
}

export async function listDocumentComments(
  ref: string,
  options: DocCommandOptions & { limit?: number } = {},
): Promise<DocCommentsData> {
  const document = await resolveDocument(ref, options);
  const limit =
    parsePositiveLimit(options.limit, DEFAULT_DOC_COMMENTS_LIMIT) ?? DEFAULT_DOC_COMMENTS_LIMIT;
  const comments = await fetchNodes<DocumentComment, DocumentCommentsResult>(
    DOCUMENT_COMMENTS_QUERY,
    (data) => data.document.comments,
    await credentialOptions(options.debug),
    { id: document.id, first: Math.min(limit, MAX_PAGE_SIZE) },
    { limit },
  );
  return { document, comments };
}

export interface DocCommentOptions extends DocCommandOptions {
  body?: string;
  bodyFile?: string;
  replyTo?: string;
  apply?: boolean;
}

export interface DocCommentData {
  applied: boolean;
  document: DocumentReference;
  input: DocumentCommentCreateInput;
  comment?: DocumentComment;
}

async function resolveReplyParent(
  commentId: string,
  document: DocumentReference,
  options: DocCommandOptions,
): Promise<string> {
  const id = commentId.trim();
  if (!id) throw new ConfigError("--reply-to requires a comment ID.");
  let comment: CommentThreadResult["comment"];
  try {
    const data = await executeGraphql<CommentThreadResult>(
      COMMENT_THREAD_QUERY,
      { id },
      await credentialOptions(options.debug),
    );
    comment = data.comment;
  } catch (err) {
    if (isEntityNotFound(err)) throw new ConfigError(`No comment found for --reply-to: ${id}`);
    throw err;
  }
  if (!comment) throw new ConfigError(`No comment found for --reply-to: ${id}`);
  if (comment.documentContentId !== document.documentContentId) {
    throw new ConfigError(`Comment ${id} is not on document "${document.title}".`);
  }
  if (comment.parent) {
    throw new ConfigError(
      `Comment ${id} is itself a reply; use its thread root --reply-to ${comment.parent.id}.`,
    );
  }
  return comment.id;
}

export async function commentOnDocument(
  ref: string,
  options: DocCommentOptions,
): Promise<DocCommentData> {
  const body = await readTextInput(options.body, options.bodyFile, {
    inline: "body",
    file: "body-file",
  });
  if (!body?.trim()) throw new ConfigError("Comment body is required. Use --body or --body-file.");
  const document = await resolveDocument(ref, options);
  if (!document.documentContentId) {
    throw new ConfigError(`Document "${document.title}" has no content to comment on.`);
  }
  const input: DocumentCommentCreateInput = { documentContentId: document.documentContentId, body };
  if (options.replyTo !== undefined) {
    input.parentId = await resolveReplyParent(options.replyTo, document, options);
  }

  if (!options.apply) return { applied: false, document, input };

  const result = await executeGraphql<DocumentCommentCreateResult>(
    DOCUMENT_COMMENT_CREATE,
    { input },
    await credentialOptions(options.debug),
  );
  if (!result.commentCreate.success) {
    throw new ConfigError("Linear reported the comment was not created.");
  }
  return { applied: true, document, input, comment: result.commentCreate.comment };
}

// ---------------------------------------------------------------------------
// Human output
// ---------------------------------------------------------------------------

function container(document: DocumentReference): string {
  if (document.project) return `project ${document.project.name}`;
  if (document.team) return `team ${document.team.key}`;
  return "(workspace)";
}

export function formatDocumentHeader(document: DocumentReference): string {
  const state = isInTrash(document) ? " [in trash]" : "";
  return [
    `${document.title || "(untitled)"}${state}`,
    `Container: ${container(document)}`,
    `Icon: ${document.icon ?? "(none)"}  Color: ${document.color ?? "(none)"}`,
    `Created: ${document.createdAt} by ${document.creator?.name ?? "(unknown)"}`,
    `Updated: ${document.updatedAt} by ${document.updatedBy?.name ?? "(unknown)"}`,
    `URL: ${document.url}`,
    `ID: ${document.id}  slugId: ${document.slugId}`,
  ].join("\n");
}

export function formatDocument(data: DocGetData): string {
  if ("section" in data) return data.section.content;
  return `${formatDocumentHeader(data)}\n\n${data.content ?? ""}`;
}

export function formatDocumentsList(documents: DocumentReference[]): {
  rows: Record<string, unknown>[];
  columns: string[];
} {
  return {
    rows: documents.map((document) => ({
      title: document.title,
      container: container(document),
      updated: document.updatedAt.slice(0, 10),
      slugId: document.slugId,
      url: document.url,
    })),
    columns: ["title", "container", "updated", "slugId", "url"],
  };
}

export function formatSearchResults(hits: DocSearchHit[]): string {
  if (hits.length === 0) return "(no documents)";
  return hits
    .map((hit) =>
      [
        `${hit.title} (${container(hit)}, updated ${hit.updatedAt.slice(0, 10)})`,
        `  ${hit.url}`,
        hit.excerpt ? `  ${hit.excerpt}` : undefined,
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n");
}

export function formatDocumentCommentsList(comments: DocumentComment[]): {
  rows: Record<string, unknown>[];
  columns: string[];
} {
  return {
    rows: comments.map((comment) => ({
      id: comment.id,
      thread: comment.parent ? `reply to ${comment.parent.id}` : "root",
      author: comment.user?.name ?? "(unknown)",
      created: comment.createdAt.slice(0, 16),
      resolved: comment.resolvedAt ? comment.resolvedAt.slice(0, 10) : "",
      body: collapse(comment.body).slice(0, 80),
    })),
    columns: ["id", "thread", "author", "created", "resolved", "body"],
  };
}

function abbreviateContent(input: Record<string, unknown>): Record<string, unknown> {
  if (typeof input.content !== "string") return input;
  return { ...input, content: `<${input.content.length} chars; see diff>` };
}

export function formatDocumentUpdate(data: DocUpdateData): string {
  const name = `"${data.document.title}" (${data.document.slugId})`;
  if (Object.keys(data.input).length === 0) return `No changes for ${name}.`;
  if (data.applied) {
    return `Updated ${name}: updatedAt ${data.result?.updatedAt ?? "(unknown)"} -> ${data.result?.url ?? data.document.url}`;
  }
  const lines = [
    `Dry run: would update ${name} (read at updatedAt ${data.readUpdatedAt}).`,
    `Input:\n${JSON.stringify(abbreviateContent(data.input as Record<string, unknown>), null, 2)}`,
    `Planned changes:\n${JSON.stringify(data.plannedChanges, null, 2)}`,
  ];
  if (data.contentChange) {
    lines.push(`Content diff (${data.contentChange.mode}):\n${data.contentChange.diff}`);
    lines.push(`Re-run with --apply --expect-updated-at ${data.readUpdatedAt} to execute.`);
  } else {
    lines.push("Re-run with --apply to execute.");
  }
  return lines.join("\n");
}
