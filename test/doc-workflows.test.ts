import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test, vi } from "vitest";

import { run } from "../src/cli/shared.ts";
import {
  archiveDocument,
  buildExcerpt,
  commentOnDocument,
  createDocument,
  formatDocumentUpdate,
  getDocument,
  listDocumentComments,
  listDocuments,
  restoreDocument,
  searchDocuments,
  updateDocument,
} from "../src/commands/docs.ts";
import { appendContent, findSection, replaceSection } from "../src/commands/markdown.ts";
import { parseDocumentRef, readTextInput } from "../src/commands/shared.ts";
import { ConfigError, ConflictError } from "../src/errors.ts";
import { unifiedDiff } from "../src/output/diff.ts";
import {
  documentCommentNode,
  documentNode,
  documentNotFound,
  documentResponse,
  LEDGER_CONTENT,
  projectNode,
  projectsResponse,
  teamsResponse,
  withMockGraphql,
} from "./fixtures.ts";

const LEDGER_URL = "https://linear.app/mirelo/document/rules-ledger-1d4ba304cb49";
const READ_AT = "2026-10-19T11:04:47.787Z";

async function tempFile(name: string, content: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "linear-doc-test-"));
  const path = join(dir, name);
  await writeFile(path, content, "utf8");
  return path;
}

type Requests = Array<{ query: string; variables: Record<string, unknown> }>;

function mutationCount(requests: Requests): number {
  return requests.filter((request) => /^\s*mutation\b/.test(request.query)).length;
}

function page<T>(key: string, nodes: T[], endCursor: string | null) {
  return { [key]: { nodes, pageInfo: { hasNextPage: endCursor !== null, endCursor } } };
}

describe("document reference parsing", () => {
  test("accepts linear.app URLs, bare slugIds, and UUIDs", () => {
    expect(parseDocumentRef(LEDGER_URL)).toEqual({
      id: "1d4ba304cb49",
      kind: "url",
      workspace: "mirelo",
    });
    expect(parseDocumentRef(`${LEDGER_URL}/?foo=1#section`)).toMatchObject({
      id: "1d4ba304cb49",
    });
    expect(parseDocumentRef("https://linear.app/mirelo/document/1d4ba304cb49").id).toBe(
      "1d4ba304cb49",
    );
    expect(parseDocumentRef(" 1D4BA304CB49 ")).toEqual({ id: "1d4ba304cb49", kind: "slugId" });
    expect(parseDocumentRef("B4E2ADA1-150D-47B1-AE80-2A83DACF157A")).toEqual({
      id: "b4e2ada1-150d-47b1-ae80-2a83dacf157a",
      kind: "uuid",
    });
  });

  test("rejects non-document URLs and unrecognised refs", () => {
    expect(() => parseDocumentRef("https://linear.app/mirelo/issue/STU-1/title")).toThrow(
      /Not a Linear document URL/,
    );
    expect(() => parseDocumentRef("https://example.com/mirelo/document/x-1d4ba304cb49")).toThrow(
      ConfigError,
    );
    expect(() => parseDocumentRef("https://linear.app/mirelo/document/rules-ledger")).toThrow(
      /slugId/,
    );
    expect(() => parseDocumentRef("rules ledger")).toThrow(/Unrecognized document reference/);
    expect(() => parseDocumentRef("  ")).toThrow(/required/);
  });
});

describe("doc get", () => {
  test("resolves a URL through its slugId and returns metadata plus content", async () => {
    await withMockGraphql([documentResponse()], async (requests) => {
      const doc = await getDocument(LEDGER_URL);

      expect(requests[0]?.variables).toEqual({ id: "1d4ba304cb49" });
      expect(doc).toMatchObject({
        slugId: "1d4ba304cb49",
        title: "Rules ledger",
        team: { key: "STU" },
        content: LEDGER_CONTENT,
      });
    });
  });

  test("a missing document is a ConfigError, never an empty success", async () => {
    await withMockGraphql([documentNotFound()], async () => {
      await expect(getDocument("000000000000")).rejects.toThrow(
        new ConfigError("No document found for: 000000000000"),
      );
    });
    await withMockGraphql([documentNotFound()], async () => {
      await expect(getDocument("https://linear.app/other/document/x-000000000000")).rejects.toThrow(
        /workspace "other"; check that --profile/,
      );
    });
  });

  test("--section returns one section (nested subsections included) without full content", async () => {
    await withMockGraphql([documentResponse()], async () => {
      const data = await getDocument("1d4ba304cb49", { section: "EST-006" });

      expect(data).not.toHaveProperty("content");
      expect(data).toMatchObject({
        section: {
          heading: "EST-006 — assign reviewer person-only",
          level: 2,
          line: 7,
          content: [
            "## EST-006 — assign reviewer person-only",
            "",
            "* **rule:** old six",
            "",
            "### Notes",
            "",
            "nested detail",
          ].join("\n"),
        },
      });
    });
  });

  test("--section fails clearly on zero or multiple matches", async () => {
    await withMockGraphql([documentResponse()], async () => {
      await expect(getDocument("1d4ba304cb49", { section: "EST-999" })).rejects.toThrow(
        /No section heading matches "EST-999"/,
      );
    });
    await withMockGraphql([documentResponse()], async () => {
      await expect(getDocument("1d4ba304cb49", { section: "EST" })).rejects.toThrow(
        /ambiguous; 3 headings match/,
      );
    });
  });

  test("JSON envelopes carry data on success and a typed error on not-found", async () => {
    const writes: string[] = [];
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });
    const previousExitCode = process.exitCode;
    try {
      await withMockGraphql([documentResponse(), documentNotFound()], async () => {
        await run(
          "doc.get",
          { json: true },
          () => getDocument(LEDGER_URL),
          () => "",
        );
        await run(
          "doc.get",
          { json: true },
          () => getDocument("000000000000"),
          () => "",
        );
      });
      const [ok, err] = writes.map((w) => JSON.parse(w) as Record<string, unknown>);
      expect(ok).toMatchObject({
        ok: true,
        operation: "doc.get",
        data: { slugId: "1d4ba304cb49", content: LEDGER_CONTENT },
      });
      expect(err).toEqual({
        ok: false,
        operation: "doc.get",
        error: { type: "ConfigError", message: "No document found for: 000000000000" },
      });
      expect(process.exitCode).toBe(2);
    } finally {
      spy.mockRestore();
      process.exitCode = previousExitCode;
    }
  });
});

describe("doc list and search", () => {
  test("list sizes pages to the limit and stops once the limit is filled", async () => {
    const docs = ["a", "b", "c", "d"].map((id) => documentNode({ id, slugId: `${id}00000000` }));
    await withMockGraphql(
      [
        page("documents", docs.slice(0, 2), "cursor-1"),
        page("documents", docs.slice(2), "cursor-2"),
      ],
      async (requests) => {
        const result = await listDocuments({ limit: 3 });

        expect(result.map((d) => d.id)).toEqual(["a", "b", "c"]);
        expect(requests).toHaveLength(2);
        expect(requests[0]?.variables).toMatchObject({
          first: 3,
          after: null,
          includeArchived: false,
        });
        expect(requests[1]?.variables).toMatchObject({ after: "cursor-1" });
        expect(requests[0]?.query).not.toMatch(/\bcontent\b/);
      },
    );
  });

  test("list defaults to 20, filters by project, and rejects bad limits", async () => {
    await withMockGraphql([projectsResponse(), page("documents", [], null)], async (requests) => {
      await listDocuments({ project: "Transcriptor" });
      expect(requests[1]?.variables).toMatchObject({
        first: 20,
        filter: { project: { id: { eq: "p1" } } },
      });
    });
    await expect(listDocuments({ limit: 0 })).rejects.toThrow(/positive integer/);
    await expect(listDocuments({ project: "x", team: "y" })).rejects.toThrow(/either --project/);
  });

  test("search returns metadata plus an excerpt, never full content", async () => {
    const hit = documentNode({
      content: `${"filler ".repeat(40)}the rules ledger lives here. ${"tail ".repeat(60)}`,
    });
    await withMockGraphql([page("searchDocuments", [hit], "more")], async (requests) => {
      const hits = await searchDocuments("rules ledger", { limit: 1 });

      expect(hits).toHaveLength(1);
      expect(hits[0]).not.toHaveProperty("content");
      expect(hits[0]?.excerpt).toContain("the rules ledger lives here.");
      expect(hits[0]?.excerpt.length).toBeLessThan(220);
      expect(requests).toHaveLength(1);
      expect(requests[0]?.variables).toMatchObject({ term: "rules ledger", first: 1 });
    });
  });

  test("search --project filters client-side over a bounded number of pages", async () => {
    const other = documentNode({ project: { id: "p-other", name: "Other" } });
    const pages = Array.from({ length: 6 }, (_, i) => page("searchDocuments", [other], `c${i}`));
    await withMockGraphql([projectsResponse([projectNode()]), ...pages], async (requests) => {
      const hits = await searchDocuments("ledger", { project: "Transcriptor", limit: 5 });

      expect(hits).toEqual([]);
      // 1 project lookup + 4 search pages (SEARCH_PROJECT_SCAN_PAGES), not 6.
      expect(requests).toHaveLength(5);
      expect(requests[1]?.variables).toMatchObject({ first: 50 });
    });
  });

  test("search --team boosts by teamId and keeps only that team's documents", async () => {
    const inTeam = documentNode({ id: "d-team", team: { id: "t1", key: "STU", name: "Studio" } });
    const otherTeam = documentNode({ id: "d-other", team: { id: "t2", key: "OPS", name: "Ops" } });
    await withMockGraphql(
      [teamsResponse(), page("searchDocuments", [otherTeam, inTeam], null)],
      async (requests) => {
        const hits = await searchDocuments("ledger", { team: "STU" });
        expect(hits.map((hit) => hit.id)).toEqual(["d-team"]);
        expect(requests[1]?.variables).toMatchObject({ teamId: "t1", first: 50 });
        expect(requests[1]?.query).toContain("teamId: $teamId");
      },
    );
    await expect(searchDocuments("  ")).rejects.toThrow(/Search text is required/);
  });

  test("excerpts fall back to individual words and to the document start", () => {
    expect(buildExcerpt("alpha beta ledger gamma", "rules ledger")).toBe("alpha beta ledger gamma");
    expect(buildExcerpt("short body", "zzz")).toBe("short body");
    expect(buildExcerpt(null, "x")).toBe("");
  });
});

describe("doc create", () => {
  test("dry run shows the exact payload and makes no mutation call", async () => {
    await withMockGraphql([teamsResponse()], async (requests) => {
      const data = await createDocument({
        title: " Scratch ",
        team: "STU",
        content: "# Hello",
        icon: "Database",
        color: "#0ea5e9",
      });

      expect(data).toEqual({
        applied: false,
        input: {
          title: "Scratch",
          content: "# Hello",
          teamId: "t1",
          icon: "Database",
          color: "#0ea5e9",
        },
      });
      expect(mutationCount(requests)).toBe(0);
    });
  });

  test("--apply sends documentCreate with the planned input", async () => {
    const created = documentNode({ title: "Scratch", project: { id: "p1", name: "Transcriptor" } });
    const file = await tempFile("body.md", "body");
    await withMockGraphql(
      [projectsResponse(), { documentCreate: { success: true, document: created } }],
      async (requests) => {
        const data = await createDocument({
          title: "Scratch",
          project: "Transcriptor",
          contentFile: file,
          apply: true,
        });

        expect(data.applied).toBe(true);
        expect(data.result?.url).toBe(created.url);
        expect(mutationCount(requests)).toBe(1);
        expect(requests.at(-1)?.query).toContain("documentCreate");
        expect(requests.at(-1)?.variables).toEqual({
          input: { title: "Scratch", content: "body", projectId: "p1" },
        });
      },
    );
  });

  test("validates title, color, and a single container", async () => {
    await expect(createDocument({ title: "  " })).rejects.toThrow(/--title is required/);
    await expect(createDocument({ title: "x", color: "blue" })).rejects.toThrow(/hex color/);
    await expect(createDocument({ title: "x", project: "p", team: "t" })).rejects.toThrow(
      /either --project or --team/,
    );
  });
});

describe("doc update", () => {
  const NEW_SECTION = "## EST-006 — assign reviewer person-only\n\n* **rule:** new six\n";

  test("section replace changes only that section and the dry run shows a unified diff", async () => {
    await withMockGraphql([documentResponse()], async (requests) => {
      const data = await updateDocument(LEDGER_URL, { section: "EST-006", content: NEW_SECTION });

      expect(data.applied).toBe(false);
      expect(mutationCount(requests)).toBe(0);
      expect(data.readUpdatedAt).toBe(READ_AT);
      expect(data.input.content).toBe(
        [
          "Intro paragraph.",
          "",
          "## EST-005 — lock quoted lines",
          "",
          "* **rule:** old five",
          "",
          "## EST-006 — assign reviewer person-only",
          "",
          "* **rule:** new six",
          "",
          "## EST-007 — default margin 0",
          "",
          "* **rule:** seven",
        ].join("\n"),
      );
      const diff = data.contentChange?.diff ?? "";
      expect(diff).toContain(`--- a/1d4ba304cb49 (updatedAt ${READ_AT})`);
      expect(diff).toContain("-* **rule:** old six");
      expect(diff).toContain("+* **rule:** new six");
      expect(diff).toContain("-### Notes");
      expect(diff).not.toContain("old five");
      expect(formatDocumentUpdate(data)).toContain(`--apply --expect-updated-at ${READ_AT}`);
      expect(formatDocumentUpdate(data)).toContain("<");
    });
  });

  test("append adds to the end separated by a blank line", async () => {
    const file = await tempFile("append.md", "## EST-008 — new\n\n* rule\n");
    await withMockGraphql([documentResponse()], async (requests) => {
      const data = await updateDocument("1d4ba304cb49", { appendFile: file });
      expect(data.contentChange?.mode).toBe("append");
      expect(data.input.content).toBe(`${LEDGER_CONTENT}\n\n## EST-008 — new\n\n* rule`);
      expect(data.contentChange?.diff).toContain("+## EST-008 — new");
      expect(mutationCount(requests)).toBe(0);
    });

    expect(appendContent(LEDGER_CONTENT, "## EST-008 — new\n\n* rule\n\n")).toBe(
      `${LEDGER_CONTENT}\n\n## EST-008 — new\n\n* rule`,
    );
    expect(appendContent("", "first")).toBe("first");
    expect(() => appendContent("x", "  \n")).toThrow(/empty/);
  });

  test("--apply without --expect-updated-at refuses a content edit and writes nothing", async () => {
    await withMockGraphql([documentResponse()], async (requests) => {
      await expect(
        updateDocument("1d4ba304cb49", { content: "new body", apply: true }),
      ).rejects.toThrow(/--expect-updated-at/);
      expect(mutationCount(requests)).toBe(0);
    });
  });

  test("a stale --expect-updated-at refuses with ConflictError (dry run too)", async () => {
    await withMockGraphql([documentResponse()], async (requests) => {
      const err = await updateDocument("1d4ba304cb49", {
        content: "new body",
        expectUpdatedAt: "2026-10-01T00:00:00.000Z",
        apply: true,
      }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ConflictError);
      expect((err as ConflictError).details).toEqual({
        expectedUpdatedAt: "2026-10-01T00:00:00.000Z",
        actualUpdatedAt: READ_AT,
      });
      expect(mutationCount(requests)).toBe(0);
    });
  });

  test("a concurrent edit between the read and the write is refused", async () => {
    const edited = { updatedAt: "2026-10-19T12:00:00.000Z", content: "human edit" };
    await withMockGraphql([documentResponse(), documentResponse(edited)], async (requests) => {
      await expect(
        updateDocument("1d4ba304cb49", {
          section: "EST-006",
          content: NEW_SECTION,
          expectUpdatedAt: READ_AT,
          apply: true,
        }),
      ).rejects.toBeInstanceOf(ConflictError);
      expect(requests).toHaveLength(2);
      expect(mutationCount(requests)).toBe(0);
    });
  });

  test("--apply with a matching --expect-updated-at re-reads, then sends documentUpdate", async () => {
    const updated = documentNode({ updatedAt: "2026-10-31T10:00:00.000Z" });
    await withMockGraphql(
      [
        documentResponse(),
        documentResponse(),
        { documentUpdate: { success: true, document: updated } },
      ],
      async (requests) => {
        const data = await updateDocument("1d4ba304cb49", {
          content: "replacement body",
          title: "Rules ledger v2",
          expectUpdatedAt: READ_AT,
          apply: true,
        });

        expect(data.applied).toBe(true);
        expect(data.result?.updatedAt).toBe("2026-10-31T10:00:00.000Z");
        expect(requests[1]?.variables).toEqual({ id: documentNode().id });
        expect(mutationCount(requests)).toBe(1);
        expect(requests.at(-1)?.variables).toEqual({
          id: documentNode().id,
          input: { title: "Rules ledger v2", content: "replacement body" },
        });
      },
    );
  });

  test("metadata-only edits apply without a content guard; unchanged values are a no-op", async () => {
    await withMockGraphql(
      [
        documentResponse(),
        projectsResponse(),
        { documentUpdate: { success: true, document: documentNode() } },
      ],
      async (requests) => {
        const data = await updateDocument("1d4ba304cb49", {
          project: "Transcriptor",
          color: "#fff",
          apply: true,
        });
        expect(data.applied).toBe(true);
        expect(requests.at(-1)?.variables).toEqual({
          id: documentNode().id,
          input: { projectId: "p1", color: "#fff" },
        });
        expect(data.plannedChanges.project).toEqual({ from: null, to: "Transcriptor" });
      },
    );
    await withMockGraphql([documentResponse()], async (requests) => {
      const data = await updateDocument("1d4ba304cb49", {
        title: "Rules ledger",
        content: LEDGER_CONTENT,
        apply: true,
      });
      expect(data).toMatchObject({ applied: false, input: {}, plannedChanges: {} });
      expect(mutationCount(requests)).toBe(0);
    });
  });

  test("content option combinations are validated", async () => {
    await withMockGraphql([documentResponse()], async () => {
      await expect(updateDocument("1d4ba304cb49", { section: "EST-006" })).rejects.toThrow(
        /--section on doc update needs --content/,
      );
    });
    await withMockGraphql([documentResponse()], async () => {
      await expect(
        updateDocument("1d4ba304cb49", { section: "EST-006", content: "no heading here" }),
      ).rejects.toThrow(/must start with a markdown heading/);
    });
    await withMockGraphql([documentResponse()], async () => {
      await expect(
        updateDocument("1d4ba304cb49", { appendFile: "x.md", content: "y" }),
      ).rejects.toThrow(/cannot be combined/);
    });
  });
});

describe("doc archive and restore", () => {
  test("archive dry run reports the documentDelete payload; --apply sends it", async () => {
    await withMockGraphql([documentResponse()], async (requests) => {
      const data = await archiveDocument("1d4ba304cb49");
      expect(data).toMatchObject({
        applied: false,
        noop: false,
        mutation: "documentDelete",
        variables: { id: documentNode().id },
      });
      expect(mutationCount(requests)).toBe(0);
    });

    const trashed = documentNode({ trashed: true, archivedAt: "2026-10-31T00:00:00.000Z" });
    await withMockGraphql(
      [documentResponse(), { documentDelete: { success: true, entity: trashed } }],
      async (requests) => {
        const data = await archiveDocument("1d4ba304cb49", { apply: true });
        expect(data.applied).toBe(true);
        expect(requests.at(-1)?.query).toContain("documentDelete(id: $id)");
        expect(requests.at(-1)?.variables).toEqual({ id: documentNode().id });
      },
    );
  });

  test("restore sends documentUnarchive and is a no-op for a document not in trash", async () => {
    const trashed = { trashed: true, archivedAt: "2026-10-31T00:00:00.000Z" };
    await withMockGraphql(
      [documentResponse(trashed), { documentUnarchive: { success: true, entity: documentNode() } }],
      async (requests) => {
        const data = await restoreDocument("1d4ba304cb49", { apply: true });
        expect(data).toMatchObject({ applied: true, mutation: "documentUnarchive" });
        expect(requests.at(-1)?.query).toContain("documentUnarchive(id: $id)");
        expect(requests.at(-1)?.variables).toEqual({ id: documentNode().id });
      },
    );
    await withMockGraphql([documentResponse()], async (requests) => {
      const data = await restoreDocument("1d4ba304cb49", { apply: true });
      expect(data).toMatchObject({ applied: false, noop: true });
      expect(mutationCount(requests)).toBe(0);
    });
    await withMockGraphql([documentResponse(trashed)], async (requests) => {
      const data = await archiveDocument("1d4ba304cb49", { apply: true });
      expect(data).toMatchObject({ applied: false, noop: true });
      expect(mutationCount(requests)).toBe(0);
    });
  });
});

describe("doc comments", () => {
  test("lists comments with author, resolved state, and thread parent within the limit", async () => {
    const root = documentCommentNode();
    const reply = documentCommentNode({
      id: "c2",
      parent: { id: "c1" },
      resolvedAt: "2026-10-21T00:00:00.000Z",
    });
    await withMockGraphql(
      [documentResponse(), { document: { id: "d", ...page("comments", [root, reply], "more") } }],
      async (requests) => {
        const data = await listDocumentComments("1d4ba304cb49", { limit: 2 });
        expect(data.comments.map((c) => [c.id, c.parent?.id ?? null, c.resolvedAt])).toEqual([
          ["c1", null, null],
          ["c2", "c1", "2026-10-21T00:00:00.000Z"],
        ]);
        expect(requests).toHaveLength(2);
        expect(requests[1]?.variables).toMatchObject({ id: documentNode().id, first: 2 });
      },
    );
  });

  test("comment dry run plans commentCreate on the document content without a mutation", async () => {
    await withMockGraphql([documentResponse()], async (requests) => {
      const data = await commentOnDocument(LEDGER_URL, { body: "Looks right." });
      expect(data).toMatchObject({
        applied: false,
        input: { documentContentId: "dc-1", body: "Looks right." },
      });
      expect(mutationCount(requests)).toBe(0);
    });
    await expect(commentOnDocument("1d4ba304cb49", { body: " " })).rejects.toThrow(
      /body is required/,
    );
  });

  test("reply validates the thread root belongs to the document, then --apply creates it", async () => {
    const created = documentCommentNode({ id: "c9", parent: { id: "c1" } });
    await withMockGraphql(
      [
        documentResponse(),
        { comment: { id: "c1", documentContentId: "dc-1", parent: null } },
        { commentCreate: { success: true, comment: created } },
      ],
      async (requests) => {
        const data = await commentOnDocument("1d4ba304cb49", {
          body: "Agreed.",
          replyTo: "c1",
          apply: true,
        });
        expect(data.applied).toBe(true);
        expect(data.comment?.parent?.id).toBe("c1");
        expect(requests.at(-1)?.variables).toEqual({
          input: { documentContentId: "dc-1", body: "Agreed.", parentId: "c1" },
        });
      },
    );
  });

  test("reply refuses comments from another document or nested replies", async () => {
    await withMockGraphql(
      [documentResponse(), { comment: { id: "c1", documentContentId: "dc-other", parent: null } }],
      async (requests) => {
        await expect(
          commentOnDocument("1d4ba304cb49", { body: "x", replyTo: "c1", apply: true }),
        ).rejects.toThrow(/not on document/);
        expect(mutationCount(requests)).toBe(0);
      },
    );
    await withMockGraphql(
      [
        documentResponse(),
        { comment: { id: "c2", documentContentId: "dc-1", parent: { id: "c1" } } },
      ],
      async () => {
        await expect(
          commentOnDocument("1d4ba304cb49", { body: "x", replyTo: "c2" }),
        ).rejects.toThrow(/--reply-to c1/);
      },
    );
  });
});

describe("markdown and diff helpers", () => {
  test("headings inside fenced code are ignored and the last section runs to the end", () => {
    const content = "## A\n\n```md\n## B (in code)\n```\n\n## C\n\ntext";
    expect(findSection(content, "A").content).toBe("## A\n\n```md\n## B (in code)\n```");
    expect(() => findSection(content, "B (in code)")).toThrow(/No section heading/);
    expect(replaceSection(content, "C", "## C\n\nnew")).toBe(
      "## A\n\n```md\n## B (in code)\n```\n\n## C\n\nnew",
    );
  });

  test("unified diff renders hunk headers with context and is empty for no change", () => {
    const before = ["1", "2", "3", "4", "5", "6", "7", "8"].join("\n");
    const after = ["1", "2", "3", "4", "five", "6", "7", "8"].join("\n");
    expect(unifiedDiff(before, after)).toBe(
      ["--- a", "+++ b", "@@ -2,7 +2,7 @@", " 2", " 3", " 4", "-5", "+five", " 6", " 7", " 8"].join(
        "\n",
      ),
    );
    expect(unifiedDiff("same", "same")).toBe("");
    expect(unifiedDiff("", "new")).toBe(
      ["--- a", "+++ b", "@@ -1,1 +1,1 @@", "-", "+new"].join("\n"),
    );
  });

  test("text input reads stdin for '-' and rejects conflicting flags", async () => {
    const flags = { inline: "content", file: "content-file" };
    await expect(readTextInput(undefined, "-", flags, async () => "from stdin")).resolves.toBe(
      "from stdin",
    );
    await expect(readTextInput("a", "b", flags)).rejects.toThrow(
      /either --content or --content-file/,
    );
    await expect(readTextInput(undefined, "/nonexistent/x.md", flags)).rejects.toThrow(
      /Could not read --content-file/,
    );
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
