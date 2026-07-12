import { describe, expect, test } from "vitest";

import { formatWhoami, whoami } from "../src/commands/auth.ts";
import { listTeams } from "../src/commands/teams.ts";
import { listUsers } from "../src/commands/users.ts";
import {
  createWebhook,
  deleteWebhook,
  formatWebhooksList,
  listWebhooks,
} from "../src/commands/webhooks.ts";
import { ConfigError } from "../src/errors.ts";
import { withMockGraphql } from "./fixtures.ts";

describe("createWebhook validation (dry-run, no network)", () => {
  const base = { resources: ["Issue"], team: "T1" };

  test("formatWebhooksList redacts URL secrets", () => {
    const { rows } = formatWebhooksList([
      {
        id: "w1",
        url: "https://example.com/hook?token=abc&ok=1",
        enabled: true,
        resourceTypes: ["Issue"],
        label: null,
        team: null,
        creator: null,
      },
    ]);

    expect(rows[0]?.url).toBe("https://example.com/hook?token=[REDACTED]&ok=1");
  });

  test("rejects non-HTTPS URLs", async () => {
    await expect(createWebhook({ ...base, url: "http://ex.com/h" })).rejects.toThrow(ConfigError);
  });

  test("rejects localhost URLs", async () => {
    await expect(createWebhook({ ...base, url: "https://localhost/h" })).rejects.toThrow(
      ConfigError,
    );
  });

  test("requires at least one resource", async () => {
    await expect(
      createWebhook({ url: "https://ex.com/h", team: "T1", resources: [] }),
    ).rejects.toThrow(ConfigError);
  });

  test("requires a scope", async () => {
    await expect(createWebhook({ url: "https://ex.com/h", resources: ["Issue"] })).rejects.toThrow(
      ConfigError,
    );
  });

  test("rejects both scopes at once", async () => {
    await expect(
      createWebhook({
        url: "https://ex.com/h",
        team: "T1",
        allPublicTeams: true,
        resources: ["Issue"],
      }),
    ).rejects.toThrow(ConfigError);
  });

  test("valid dry-run returns the planned input without applying", async () => {
    const result = await createWebhook({ ...base, url: "https://ex.com/h", label: "CI" });
    expect(result.applied).toBe(false);
    expect(result.input).toEqual({
      url: "https://ex.com/h",
      resourceTypes: ["Issue"],
      label: "CI",
      teamId: "T1",
    });
  });

  test("valid dry-run redacts URL secrets in returned input", async () => {
    const result = await createWebhook({
      ...base,
      url: "https://ex.com/h?token=abc&ok=1",
    });

    expect(result.input).toEqual({
      url: "https://ex.com/h?token=[REDACTED]&ok=1",
      resourceTypes: ["Issue"],
      teamId: "T1",
    });
  });
});

describe("offline GraphQL command execution", () => {
  test("whoami formats authenticated identity and organization", async () => {
    await withMockGraphql(
      [
        {
          viewer: { id: "u1", name: "Ada", email: "ada@example.com" },
          organization: { id: "o1", name: "Example", urlKey: "example" },
        },
      ],
      async (requests) => {
        const result = await whoami({});

        expect(requests).toHaveLength(1);
        expect(result.credentialKind).toBe("apiKey");
        expect(formatWhoami(result)).toContain("Authenticated as Ada <ada@example.com>");
      },
    );
  });

  test("listWebhooks follows pagination", async () => {
    await withMockGraphql(
      [
        {
          webhooks: {
            nodes: [
              {
                id: "w1",
                url: "https://example.com/a?token=abc&ok=1",
                enabled: true,
                resourceTypes: ["Issue"],
                label: null,
                team: null,
                creator: null,
              },
            ],
            pageInfo: { hasNextPage: true, endCursor: "cursor-1" },
          },
        },
        {
          webhooks: {
            nodes: [
              {
                id: "w2",
                url: "https://example.com/b",
                enabled: false,
                resourceTypes: ["Comment"],
                label: "Comments",
                team: { id: "t1", name: "Engineering" },
                creator: { id: "u1", name: "Ada" },
              },
            ],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      ],
      async (requests) => {
        const webhooks = await listWebhooks({});

        expect(webhooks.map((webhook) => webhook.id)).toEqual(["w1", "w2"]);
        expect(webhooks[0]?.url).toBe("https://example.com/a?token=[REDACTED]&ok=1");
        expect(requests.map((request) => request.variables.after)).toEqual([null, "cursor-1"]);
      },
    );
  });

  test("createWebhook applies the mutation with the planned input", async () => {
    await withMockGraphql(
      [
        {
          webhookCreate: {
            success: true,
            webhook: {
              id: "w1",
              url: "https://example.com/hook",
              enabled: true,
              resourceTypes: ["Issue"],
              label: "CI",
              team: { id: "t1", name: "Engineering" },
              creator: null,
            },
          },
        },
      ],
      async (requests) => {
        const result = await createWebhook({
          url: "https://example.com/hook",
          team: "ENG",
          resources: ["Issue"],
          label: "CI",
          apply: true,
        });

        expect(result.applied).toBe(true);
        expect(result.webhook?.id).toBe("w1");
        expect(requests[0]?.variables.input).toEqual({
          url: "https://example.com/hook",
          resourceTypes: ["Issue"],
          label: "CI",
          teamId: "ENG",
        });
      },
    );
  });

  test("createWebhook keeps mutation URL raw and returns redacted output", async () => {
    await withMockGraphql(
      [
        {
          webhookCreate: {
            success: true,
            webhook: {
              id: "w1",
              url: "https://example.com/hook?token=abc&ok=1",
              enabled: true,
              resourceTypes: ["Issue"],
              label: "CI",
              team: { id: "t1", name: "Engineering" },
              creator: null,
            },
          },
        },
      ],
      async (requests) => {
        const result = await createWebhook({
          url: "https://example.com/hook?token=abc&ok=1",
          team: "ENG",
          resources: ["Issue"],
          label: "CI",
          apply: true,
        });

        expect(requests[0]?.variables.input).toEqual({
          url: "https://example.com/hook?token=abc&ok=1",
          resourceTypes: ["Issue"],
          label: "CI",
          teamId: "ENG",
        });
        expect(result.input.url).toBe("https://example.com/hook?token=[REDACTED]&ok=1");
        expect(result.webhook?.url).toBe("https://example.com/hook?token=[REDACTED]&ok=1");
      },
    );
  });

  test("deleteWebhook previews before applying deletion", async () => {
    const webhook = {
      id: "w1",
      url: "https://example.com/hook",
      enabled: true,
      resourceTypes: ["Issue"],
      label: null,
      team: null,
      creator: null,
    };

    await withMockGraphql([{ webhook }, { webhookDelete: { success: true } }], async (requests) => {
      const result = await deleteWebhook("w1", { apply: true });

      expect(result).toEqual({ applied: true, webhook });
      expect(requests.map((request) => request.variables)).toEqual([{ id: "w1" }, { id: "w1" }]);
    });
  });

  test("listTeams and listUsers apply local filters to fetched results", async () => {
    await withMockGraphql(
      [
        {
          teams: {
            nodes: [
              { id: "t1", key: "ENG", name: "Engineering", private: true, archivedAt: null },
              { id: "t2", key: "MKT", name: "Marketing", private: false, archivedAt: null },
            ],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
        {
          users: {
            nodes: [
              {
                id: "u1",
                name: "Ada",
                email: "ada@example.com",
                active: true,
                admin: true,
                archivedAt: null,
              },
              {
                id: "u2",
                name: "Lin",
                email: "lin@example.com",
                active: false,
                admin: false,
                archivedAt: null,
              },
            ],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      ],
      async () => {
        await expect(listTeams({ publicOnly: true })).resolves.toEqual([
          { id: "t2", key: "MKT", name: "Marketing", private: false, archivedAt: null },
        ]);
        await expect(listUsers({ inactiveOnly: true })).resolves.toEqual([
          {
            id: "u2",
            name: "Lin",
            email: "lin@example.com",
            active: false,
            admin: false,
            archivedAt: null,
          },
        ]);
      },
    );
  });
});
