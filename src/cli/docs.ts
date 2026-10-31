import type { Command } from "commander";

import {
  archiveDocument,
  commentOnDocument,
  createDocument,
  DEFAULT_DOC_COMMENTS_LIMIT,
  DEFAULT_DOC_LIST_LIMIT,
  formatDocument,
  formatDocumentCommentsList,
  formatDocumentsList,
  formatDocumentUpdate,
  formatSearchResults,
  getDocument,
  listDocumentComments,
  listDocuments,
  restoreDocument,
  searchDocuments,
  updateDocument,
  type DocTrashData,
} from "../commands/docs.ts";
import { renderTable } from "../output/format.ts";
import { globals, run } from "./shared.ts";

const REF_HELP = "document URL (linear.app/<org>/document/<slug>-<slugId>), slugId, or UUID";

const parseLimit = (value: string) => Number(value);

function formatTrash(verb: "move to trash" | "restore", data: DocTrashData): string {
  const name = `"${data.document.title}" (${data.document.slugId})`;
  if (data.noop) {
    return verb === "restore"
      ? `${name} is not in the trash; nothing to restore.`
      : `${name} is already in the trash.`;
  }
  if (!data.applied) {
    return `Dry run: would ${verb} ${name} via ${data.mutation}(${JSON.stringify(data.variables)}).\nRe-run with --apply to execute.`;
  }
  return verb === "restore" ? `Restored ${name}: ${data.document.url}` : `Moved ${name} to trash.`;
}

export function addDocCommands(program: Command): void {
  const doc = program
    .command("doc")
    .description("Linear Docs: read, search, create, update, trash/restore, comments");
  addDocReadCommands(doc);
  addDocWriteCommands(doc);
  addDocTrashCommands(doc);
  addDocCommentCommands(doc);
}

function addDocReadCommands(doc: Command): void {
  doc
    .command("get")
    .description("Get a document with its markdown content")
    .argument("<ref>", REF_HELP)
    .option("--section <heading>", "print only the markdown section under this heading")
    .action(async function (this: Command, ref: string, opts: { section?: string }) {
      const g = globals(this);
      await run("doc.get", g, () => getDocument(ref, { ...opts, debug: g.debug }), formatDocument);
    });

  doc
    .command("list")
    .description("List documents (metadata only), most recently updated first")
    .option("--project <project>", "project name or ID")
    .option("--team <team>", "team key, name, or ID (team-level docs)")
    .option("--include-archived", "include trashed/archived documents")
    .option("--limit <n>", `max documents (default ${DEFAULT_DOC_LIST_LIMIT})`, parseLimit)
    .action(async function (
      this: Command,
      opts: { project?: string; team?: string; includeArchived?: boolean; limit?: number },
    ) {
      const g = globals(this);
      await run(
        "doc.list",
        g,
        () => listDocuments({ ...opts, debug: g.debug }),
        (data) => {
          const { rows, columns } = formatDocumentsList(data);
          return renderTable(rows, columns);
        },
      );
    });

  doc
    .command("search")
    .description("Search document titles and content; returns metadata plus a short excerpt")
    .argument("<text>", "search text")
    .option("--project <project>", "only documents in this project (name or ID)")
    .option("--team <team>", "only documents in this team (key, name, or ID)")
    .option("--include-archived", "include trashed/archived documents")
    .option("--limit <n>", `max results (default ${DEFAULT_DOC_LIST_LIMIT})`, parseLimit)
    .action(async function (
      this: Command,
      text: string,
      opts: { project?: string; team?: string; includeArchived?: boolean; limit?: number },
    ) {
      const g = globals(this);
      await run(
        "doc.search",
        g,
        () => searchDocuments(text, { ...opts, debug: g.debug }),
        formatSearchResults,
      );
    });
}

function addDocWriteCommands(doc: Command): void {
  doc
    .command("create")
    .description("Create a document (dry-run unless --apply)")
    .requiredOption("--title <title>", "document title")
    .option("--project <project>", "project name or ID")
    .option("--team <team>", "team key, name, or ID for a team-level doc")
    .option("--content <markdown>", "markdown body")
    .option("--content-file <file>", "read the markdown body from a file, or - for stdin")
    .option("--icon <icon>", "icon name or emoji")
    .option("--color <hex>", "icon color, e.g. #0ea5e9")
    .option("--apply", "create the document (dry-run by default)")
    .action(async function (
      this: Command,
      opts: {
        title: string;
        project?: string;
        team?: string;
        content?: string;
        contentFile?: string;
        icon?: string;
        color?: string;
        apply?: boolean;
      },
    ) {
      const g = globals(this);
      await run(
        "doc.create",
        g,
        () => createDocument({ ...opts, debug: g.debug }),
        (data) => {
          if (!data.applied) {
            return `Dry run: would call documentCreate with input:\n${JSON.stringify(data.input, null, 2)}\nRe-run with --apply to execute.`;
          }
          return `Created "${data.result?.title}" (${data.result?.slugId}): ${data.result?.url}`;
        },
      );
    });

  doc
    .command("update")
    .description("Update a document's metadata or content (dry-run with diff unless --apply)")
    .argument("<ref>", REF_HELP)
    .option("--title <title>", "new title")
    .option("--project <project>", "move to this project (name or ID)")
    .option("--icon <icon>", "icon name or emoji")
    .option("--color <hex>", "icon color, e.g. #0ea5e9")
    .option("--content <markdown>", "replace the whole body (or the --section) with this markdown")
    .option("--content-file <file>", "like --content, read from a file or - for stdin")
    .option(
      "--section <heading>",
      "replace only this section (heading through the next same-or-higher heading)",
    )
    .option("--append-file <file>", "append markdown from a file (or - for stdin) to the end")
    .option(
      "--expect-updated-at <iso>",
      "refuse unless the doc's updatedAt matches (required with --apply for content edits)",
    )
    .option("--apply", "execute the update (dry-run by default)")
    .action(async function (
      this: Command,
      ref: string,
      opts: {
        title?: string;
        project?: string;
        icon?: string;
        color?: string;
        content?: string;
        contentFile?: string;
        section?: string;
        appendFile?: string;
        expectUpdatedAt?: string;
        apply?: boolean;
      },
    ) {
      const g = globals(this);
      await run(
        "doc.update",
        g,
        () => updateDocument(ref, { ...opts, debug: g.debug }),
        formatDocumentUpdate,
      );
    });
}

function addDocTrashCommands(doc: Command): void {
  doc
    .command("archive")
    .description("Move a document to Linear's trash; restorable (dry-run unless --apply)")
    .argument("<ref>", REF_HELP)
    .option("--apply", "execute (dry-run by default)")
    .action(async function (this: Command, ref: string, opts: { apply?: boolean }) {
      const g = globals(this);
      await run(
        "doc.archive",
        g,
        () => archiveDocument(ref, { ...opts, debug: g.debug }),
        (data) => formatTrash("move to trash", data),
      );
    });

  doc
    .command("restore")
    .description("Restore a trashed document (dry-run unless --apply)")
    .argument("<ref>", REF_HELP)
    .option("--apply", "execute (dry-run by default)")
    .action(async function (this: Command, ref: string, opts: { apply?: boolean }) {
      const g = globals(this);
      await run(
        "doc.restore",
        g,
        () => restoreDocument(ref, { ...opts, debug: g.debug }),
        (data) => formatTrash("restore", data),
      );
    });
}

function addDocCommentCommands(doc: Command): void {
  doc
    .command("comments")
    .description("List comments on a document")
    .argument("<ref>", REF_HELP)
    .option("--limit <n>", `max comments (default ${DEFAULT_DOC_COMMENTS_LIMIT})`, parseLimit)
    .action(async function (this: Command, ref: string, opts: { limit?: number }) {
      const g = globals(this);
      await run(
        "doc.comments",
        g,
        () => listDocumentComments(ref, { ...opts, debug: g.debug }),
        (data) => {
          const { rows, columns } = formatDocumentCommentsList(data.comments);
          return `"${data.document.title}" comments (${data.comments.length})\n${renderTable(rows, columns)}`;
        },
      );
    });

  doc
    .command("comment")
    .description("Comment on a document, or reply to a comment thread (dry-run unless --apply)")
    .argument("<ref>", REF_HELP)
    .option("--body <markdown>", "comment body")
    .option("--body-file <file>", "read the comment body from a file, or - for stdin")
    .option("--reply-to <commentId>", "reply in this comment's thread (must be a thread root)")
    .option("--apply", "create the comment (dry-run by default)")
    .action(async function (
      this: Command,
      ref: string,
      opts: { body?: string; bodyFile?: string; replyTo?: string; apply?: boolean },
    ) {
      const g = globals(this);
      await run(
        "doc.comment",
        g,
        () => commentOnDocument(ref, { ...opts, debug: g.debug }),
        (data) => {
          const name = `"${data.document.title}" (${data.document.slugId})`;
          if (!data.applied) {
            return `Dry run: would call commentCreate on ${name} with input:\n${JSON.stringify(data.input, null, 2)}\nRe-run with --apply to execute.`;
          }
          return `Commented on ${name}: ${data.comment?.url}`;
        },
      );
    });
}
