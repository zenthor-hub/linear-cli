import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

import { describe, expect, test } from "vitest";

import { runGql } from "../src/commands/gql.ts";
import { formatTeamsList, listTeams } from "../src/commands/teams.ts";
import { formatUsersList, listUsers } from "../src/commands/users.ts";
import { ConfigError } from "../src/errors.ts";
import { computeBackoffMs, DEFAULT_BACKOFF } from "../src/graphql/retry.ts";
import { isApplied } from "../src/output/audit.ts";
import { mockFetch } from "./fixtures.ts";

describe("audit command validation and formatting", () => {
  test("listTeams rejects --private and --public together", async () => {
    await expect(listTeams({ privateOnly: true, publicOnly: true })).rejects.toThrow(ConfigError);
  });

  test("listUsers rejects --active and --inactive together", async () => {
    await expect(listUsers({ activeOnly: true, inactiveOnly: true })).rejects.toThrow(ConfigError);
  });

  test("formatTeamsList maps visibility and archived flags", () => {
    const { rows, columns } = formatTeamsList([
      { id: "t1", key: "ENG", name: "Engineering", private: true, archivedAt: null },
    ]);
    expect(columns).toContain("visibility");
    expect(rows[0]).toMatchObject({ key: "ENG", visibility: "private", archived: "no" });
  });

  test("formatUsersList maps admin and active flags", () => {
    const { rows } = formatUsersList([
      {
        id: "u1",
        name: "Ada",
        email: "ada@ex.com",
        active: true,
        admin: true,
        archivedAt: "2024-01-01",
      },
    ]);
    expect(rows[0]).toMatchObject({ name: "Ada", admin: "yes", active: "yes", archived: "yes" });
  });
});

describe("retry backoff", () => {
  test("honours a valid Retry-After header (seconds -> ms, capped)", () => {
    expect(computeBackoffMs(0, "2")).toBe(2000);
    expect(computeBackoffMs(0, "999")).toBe(DEFAULT_BACKOFF.maxDelayMs);
  });

  test("falls back to exponential backoff without a header", () => {
    expect(computeBackoffMs(0, null)).toBe(500);
    expect(computeBackoffMs(1, null)).toBe(1000);
    expect(computeBackoffMs(2, null)).toBe(2000);
  });

  test("ignores a non-numeric Retry-After", () => {
    expect(computeBackoffMs(1, "soon")).toBe(1000);
  });

  test("caps exponential growth at maxDelayMs", () => {
    expect(computeBackoffMs(20, null)).toBe(DEFAULT_BACKOFF.maxDelayMs);
  });
});

describe("audit gating", () => {
  test("isApplied is true only for executed mutations", () => {
    expect(isApplied({ applied: true })).toBe(true);
    expect(isApplied({ applied: false })).toBe(false);
    expect(isApplied({ result: [] })).toBe(false);
    expect(isApplied(null)).toBe(false);
    expect(isApplied("nope")).toBe(false);
  });

  test("raw GraphQL queries execute without being marked as applied mutations", async () => {
    const dir = await mkdtemp(join(tmpdir(), "linear-cli-"));
    const file = join(dir, "viewer.graphql");
    const originalFetch = globalThis.fetch;
    const originalApiKey = process.env.LINEAR_API_KEY;

    try {
      await writeFile(file, "query Viewer { viewer { id } }", "utf8");
      process.env.LINEAR_API_KEY = "lin_api_test";
      globalThis.fetch = mockFetch(
        async () =>
          new Response(JSON.stringify({ data: { viewer: { id: "u1" } } }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      );

      const result = await runGql(file, {});

      expect(result).toEqual({
        isMutation: false,
        applied: false,
        result: { viewer: { id: "u1" } },
      });
      expect(isApplied(result)).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalApiKey === undefined) {
        delete process.env.LINEAR_API_KEY;
      } else {
        process.env.LINEAR_API_KEY = originalApiKey;
      }
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("raw GraphQL mutation dry-runs from stdin with operation metadata and redacted variables", async () => {
    const dir = await mkdtemp(join(tmpdir(), "linear-cli-"));
    const varsFile = join(dir, "vars.json");
    const schemaFile = join(dir, "schema.graphql");
    const originalStdin = process.stdin;
    const stdinDescriptor = Object.getOwnPropertyDescriptor(process, "stdin");

    try {
      await writeFile(
        varsFile,
        JSON.stringify({ input: "hello", token: "lin_api_secret" }),
        "utf8",
      );
      await writeFile(
        schemaFile,
        [
          "schema { query: Query mutation: Mutation }",
          "type Query { viewer: Viewer! }",
          "type Viewer { id: ID! }",
          "type Mutation { projectUpdate(input: String!): Payload! }",
          "type Payload { success: Boolean! }",
        ].join("\n"),
        "utf8",
      );
      Object.defineProperty(process, "stdin", {
        configurable: true,
        value: Readable.from([
          "mutation ProjectUpdate($input: String!) { projectUpdate(input: $input) { success } }",
        ]),
      });

      const result = await runGql("-", { vars: varsFile, schema: schemaFile });

      expect(result).toMatchObject({
        isMutation: true,
        applied: false,
        operationName: "ProjectUpdate",
        operationType: "mutation",
        schemaValidated: true,
        variables: { input: "hello", token: "[REDACTED]" },
      });
    } finally {
      if (stdinDescriptor) Object.defineProperty(process, "stdin", stdinDescriptor);
      else Object.defineProperty(process, "stdin", { configurable: true, value: originalStdin });
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("raw GraphQL schema validation rejects invalid documents before execution", async () => {
    const dir = await mkdtemp(join(tmpdir(), "linear-cli-"));
    const file = join(dir, "invalid.graphql");
    const schemaFile = join(dir, "schema.graphql");

    try {
      await writeFile(file, "query Viewer { missing }", "utf8");
      await writeFile(
        schemaFile,
        ["type Query { viewer: Viewer! }", "type Viewer { id: ID! }"].join("\n"),
        "utf8",
      );

      await expect(runGql(file, { schema: schemaFile })).rejects.toThrow(/schema validation/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
