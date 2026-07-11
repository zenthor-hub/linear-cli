import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { authLogout, formatWhoami, whoami } from "../src/commands/auth.ts";
import { runGql } from "../src/commands/gql.ts";
import { commentOnIssue, createIssue, getIssue, updateIssue } from "../src/commands/issues.ts";
import { formatTeamsList, listTeams } from "../src/commands/teams.ts";
import { formatUsersList, listUsers } from "../src/commands/users.ts";
import {
  createWebhook,
  deleteWebhook,
  formatWebhooksList,
  listWebhooks,
} from "../src/commands/webhooks.ts";
import { resolveCredential } from "../src/config.ts";
import { ConfigError } from "../src/errors.ts";
import { computeBackoffMs, DEFAULT_BACKOFF } from "../src/graphql/retry.ts";
import { buildAuthorizeUrl } from "../src/oauth/authorize.ts";
import { codeChallengeS256, generateCodeVerifier } from "../src/oauth/pkce.ts";
import {
  clearStoredCredentials,
  credentialsFilePath,
  loadStoredCredentials,
  profileName,
  saveOAuthSession,
} from "../src/oauth/store.ts";
import { auditMutation, isApplied } from "../src/output/audit.ts";
import { redactHeaders, redactText, redactUrlSecrets } from "../src/output/redact.ts";
import { documentContainsMutation } from "../src/safety/mutation.ts";

function mockFetch(
  fn: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>,
): typeof fetch {
  return Object.assign(fn, { preconnect: () => undefined });
}

async function withMockGraphql<T>(
  responses: unknown[],
  body: (requests: Array<{ query: string; variables: Record<string, unknown> }>) => Promise<T>,
): Promise<T> {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.LINEAR_API_KEY;
  const requests: Array<{ query: string; variables: Record<string, unknown> }> = [];

  process.env.LINEAR_API_KEY = "lin_api_test";
  globalThis.fetch = mockFetch(async (_url, init) => {
    requests.push(
      JSON.parse(String(init?.body)) as { query: string; variables: Record<string, unknown> },
    );
    const response = responses.shift();
    if (response === undefined) {
      return new Response(JSON.stringify({ errors: [{ message: "Unexpected mock request" }] }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ data: response }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  try {
    return await body(requests);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) {
      delete process.env.LINEAR_API_KEY;
    } else {
      process.env.LINEAR_API_KEY = originalApiKey;
    }
  }
}

const teamNode = { id: "t1", key: "STU", name: "Studio", private: false, archivedAt: null };
const stateTodo = { id: "s1", name: "Todo", type: "unstarted", position: 1, team: teamNode };
const stateDone = { id: "s2", name: "Done", type: "completed", position: 2, team: teamNode };
const userAda = {
  id: "u1",
  name: "Ada",
  email: "ada@example.com",
  active: true,
  admin: false,
  archivedAt: null,
};

const parentIssue = {
  id: "parent-1",
  identifier: "STU-993",
  title: "Parent issue",
  url: "https://linear.app/mirelo/issue/STU-993/parent-issue",
};

function issueNode(overrides: Record<string, unknown> = {}) {
  return {
    id: "i1",
    identifier: "STU-123",
    number: 123,
    title: "Old title",
    description: "Old description",
    priority: 3,
    priorityLabel: "Normal",
    url: "https://linear.app/mirelo/issue/STU-123/old-title",
    branchName: "stu-123-old-title",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    team: { id: teamNode.id, key: teamNode.key, name: teamNode.name },
    state: { id: stateTodo.id, name: stateTodo.name, type: stateTodo.type },
    assignee: null,
    labels: { nodes: [] },
    project: null,
    parent: null,
    ...overrides,
  };
}

function issueLookupResponse(issue = issueNode()) {
  return { issues: { nodes: [issue], pageInfo: { hasNextPage: false, endCursor: null } } };
}

function teamsResponse() {
  return { teams: { nodes: [teamNode], pageInfo: { hasNextPage: false, endCursor: null } } };
}

function usersResponse() {
  return { users: { nodes: [userAda], pageInfo: { hasNextPage: false, endCursor: null } } };
}

function statesResponse() {
  return {
    workflowStates: {
      nodes: [stateTodo, stateDone],
      pageInfo: { hasNextPage: false, endCursor: null },
    },
  };
}

function labelsResponse() {
  return {
    issueLabels: {
      nodes: [
        {
          id: "l1",
          name: "bug",
          color: "#ff0000",
          team: { id: teamNode.id, key: teamNode.key, name: teamNode.name },
        },
      ],
      pageInfo: { hasNextPage: false, endCursor: null },
    },
  };
}

function projectsResponse(
  nodes: unknown[] = [{ id: "p1", name: "Transcriptor", state: "started" }],
) {
  return {
    projects: {
      nodes,
      pageInfo: { hasNextPage: false, endCursor: null },
    },
  };
}

describe("resolveCredential", () => {
  test("uses OAuth access token with Bearer prefix", async () => {
    const cred = await resolveCredential({
      env: { LINEAR_ACCESS_TOKEN: "tok123" } as NodeJS.ProcessEnv,
    });
    expect(cred.kind).toBe("oauth");
    expect(cred.authorizationHeader).toBe("Bearer tok123");
    expect(cred.source).toBe("accessToken");
  });

  test("uses API key without Bearer prefix", async () => {
    const cred = await resolveCredential({
      env: { LINEAR_API_KEY: "lin_api_abc" } as NodeJS.ProcessEnv,
    });
    expect(cred.kind).toBe("apiKey");
    expect(cred.authorizationHeader).toBe("lin_api_abc");
    expect(cred.source).toBe("apiKey");
  });

  test("rejects when both credentials are set", async () => {
    await expect(
      resolveCredential({
        env: {
          LINEAR_ACCESS_TOKEN: "tok",
          LINEAR_API_KEY: "key",
        } as NodeJS.ProcessEnv,
      }),
    ).rejects.toThrow(ConfigError);
  });

  test("rejects when no credential is set", async () => {
    const dir = await mkdtemp(join(tmpdir(), "linear-cli-cred-"));
    await expect(
      resolveCredential({
        env: { LINEAR_CREDENTIALS_FILE: join(dir, "missing.json") } as NodeJS.ProcessEnv,
      }),
    ).rejects.toThrow(ConfigError);
    await rm(dir, { recursive: true, force: true });
  });

  test("does not change legacy environment resolution when no profile is selected", async () => {
    const cred = await resolveCredential({
      env: { LINEAR_API_KEY: "lin_api_legacy" } as NodeJS.ProcessEnv,
    });
    expect(cred).toMatchObject({
      kind: "apiKey",
      authorizationHeader: "lin_api_legacy",
      source: "apiKey",
    });
    expect(cred.profile).toBeUndefined();
  });

  test("uses a separate safe path for a selected profile", () => {
    const path = credentialsFilePath({ LINEAR_PROFILE: "client-a" } as NodeJS.ProcessEnv);
    expect(path).toMatch(/linear-cli\/profiles\/client-a\.json$/);
    expect(profileName({ LINEAR_PROFILE: "client-a" } as NodeJS.ProcessEnv)).toBe("client-a");
    expect(() => profileName({ LINEAR_PROFILE: "../other" } as NodeJS.ProcessEnv)).toThrow(
      ConfigError,
    );
  });

  test("rejects ambiguous profile and environment credentials", async () => {
    await expect(
      resolveCredential({
        env: { LINEAR_PROFILE: "client-a", LINEAR_API_KEY: "lin_api_other" } as NodeJS.ProcessEnv,
      }),
    ).rejects.toThrow("A selected profile cannot be combined");
  });

  test("uses stored OAuth session from credentials file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "linear-cli-cred-"));
    const env = {
      LINEAR_CREDENTIALS_FILE: join(dir, "credentials.json"),
      LINEAR_CLIENT_ID: "client-1",
    } as NodeJS.ProcessEnv;

    await saveOAuthSession(
      {
        kind: "oauth",
        accessToken: "access-abc",
        refreshToken: "refresh-xyz",
        expiresAt: Date.now() + 3_600_000,
        scope: "read,write",
        tokenType: "Bearer",
        clientId: "client-1",
      },
      env,
    );

    const cred = await resolveCredential({ env });
    expect(cred.kind).toBe("oauth");
    expect(cred.authorizationHeader).toBe("Bearer access-abc");
    expect(cred.source).toBe("store");

    await clearStoredCredentials(env);
    await rm(dir, { recursive: true, force: true });
  });
});

describe("oauth pkce", () => {
  test("generates deterministic challenge for injected verifier", () => {
    const verifier = generateCodeVerifier(() =>
      Buffer.from("test-verifier-bytes-0123456789abcdef"),
    );
    expect(verifier.length).toBeGreaterThan(0);
    expect(codeChallengeS256(verifier)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  test("buildAuthorizeUrl includes PKCE and scope params", () => {
    const url = buildAuthorizeUrl({
      clientId: "cid",
      redirectUri: "http://127.0.0.1:8787/callback",
      scope: "read,write",
      state: "state123",
      codeChallenge: "challenge123",
    });
    const parsed = new URL(url);
    expect(parsed.hostname).toBe("linear.app");
    expect(parsed.searchParams.get("client_id")).toBe("cid");
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
    expect(parsed.searchParams.get("scope")).toBe("read,write");
  });
});

describe("oauth store", () => {
  test("round-trips OAuth session", async () => {
    const dir = await mkdtemp(join(tmpdir(), "linear-cli-store-"));
    const env = { LINEAR_CREDENTIALS_FILE: join(dir, "credentials.json") } as NodeJS.ProcessEnv;
    const session = {
      kind: "oauth" as const,
      accessToken: "a",
      refreshToken: "r",
      expiresAt: Date.now() + 1000,
      scope: "read",
      tokenType: "Bearer" as const,
      clientId: "c",
    };
    await saveOAuthSession(session, env);
    expect(credentialsFilePath(env)).toBe(join(dir, "credentials.json"));
    const loaded = await loadStoredCredentials(env);
    expect(loaded).toEqual(session);
    await clearStoredCredentials(env);
    expect(await loadStoredCredentials(env)).toBeNull();
    await rm(dir, { recursive: true, force: true });
  });

  test("serializes concurrent credential writes without corrupting the session file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "linear-cli-store-"));
    const env = { LINEAR_CREDENTIALS_FILE: join(dir, "credentials.json") } as NodeJS.ProcessEnv;
    const session = {
      kind: "oauth" as const,
      refreshToken: "r",
      expiresAt: Date.now() + 1000,
      scope: "read",
      tokenType: "Bearer" as const,
      clientId: "c",
    };
    await Promise.all([
      saveOAuthSession({ ...session, accessToken: "a" }, env),
      saveOAuthSession({ ...session, accessToken: "b" }, env),
    ]);
    const loaded = await loadStoredCredentials(env);
    expect(loaded?.kind).toBe("oauth");
    if (loaded?.kind === "oauth") expect(["a", "b"]).toContain(loaded.accessToken);
    await rm(dir, { recursive: true, force: true });
  });

  test("logout clears a local OAuth session even without OAuth app configuration", async () => {
    const dir = await mkdtemp(join(tmpdir(), "linear-cli-logout-"));
    const path = join(dir, "credentials.json");
    const originalFile = process.env.LINEAR_CREDENTIALS_FILE;
    const originalClientId = process.env.LINEAR_CLIENT_ID;
    process.env.LINEAR_CREDENTIALS_FILE = path;
    delete process.env.LINEAR_CLIENT_ID;
    try {
      await saveOAuthSession({
        kind: "oauth",
        accessToken: "a",
        refreshToken: "r",
        expiresAt: Date.now() + 1000,
        scope: "read",
        tokenType: "Bearer",
        clientId: "c",
      });
      await authLogout({});
      expect(await loadStoredCredentials()).toBeNull();
    } finally {
      if (originalFile === undefined) delete process.env.LINEAR_CREDENTIALS_FILE;
      else process.env.LINEAR_CREDENTIALS_FILE = originalFile;
      if (originalClientId === undefined) delete process.env.LINEAR_CLIENT_ID;
      else process.env.LINEAR_CLIENT_ID = originalClientId;
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("documentContainsMutation", () => {
  test("detects a mutation operation", () => {
    expect(documentContainsMutation('mutation M { webhookDelete(id: "x") { success } }')).toBe(
      true,
    );
  });

  test("treats a query as non-mutation", () => {
    expect(documentContainsMutation("query Q { viewer { id } }")).toBe(false);
  });

  test("is not fooled by the word mutation in a field name", () => {
    expect(documentContainsMutation("query Q { mutationCount }")).toBe(false);
  });

  test("throws ConfigError on invalid documents", () => {
    expect(() => documentContainsMutation("this is not graphql {{{")).toThrow(ConfigError);
  });
});

describe("redaction", () => {
  test("redacts an exact secret value", () => {
    expect(redactText("token=lin_api_secretvalue here", ["lin_api_secretvalue"])).not.toContain(
      "secretvalue",
    );
  });

  test("redacts Bearer tokens generically", () => {
    expect(redactText("Authorization: Bearer abc.def-123")).toBe(
      "Authorization: Bearer [REDACTED]",
    );
  });

  test("redacts shell token assignments", () => {
    expect(redactText("export LINEAR_ACCESS_TOKEN='abcdefghijklmnopqrstuvwxyz123456'")).toBe(
      "export LINEAR_ACCESS_TOKEN='[REDACTED]'",
    );
  });

  test("redacts credential-like webhook URL components", () => {
    expect(redactUrlSecrets("https://user:pass@example.com/hook?token=abc&ok=1&secret=def")).toBe(
      "https://[REDACTED]:[REDACTED]@example.com/hook?token=[REDACTED]&ok=1&secret=[REDACTED]",
    );
  });

  test("redacts auth token export hints before audit logging", async () => {
    const dir = await mkdtemp(join(tmpdir(), "linear-cli-audit-"));
    const auditPath = join(dir, "audit.jsonl");
    const originalAuditPath = process.env.LINEAR_ADMIN_AUDIT_LOG;
    const token = "abcdefghijklmnopqrstuvwxyz123456";

    process.env.LINEAR_ADMIN_AUDIT_LOG = auditPath;
    try {
      auditMutation(
        "auth.token",
        {
          applied: true,
          exportHint: `export LINEAR_ACCESS_TOKEN='${token}'`,
          scope: "read",
        },
        "2026-07-04T00:00:00.000Z",
      );

      const audit = await readFile(auditPath, "utf8");
      expect(audit).not.toContain(token);
      expect(audit).toContain('"exportHint":"[REDACTED]"');
    } finally {
      if (originalAuditPath === undefined) {
        delete process.env.LINEAR_ADMIN_AUDIT_LOG;
      } else {
        process.env.LINEAR_ADMIN_AUDIT_LOG = originalAuditPath;
      }
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("redacts the authorization header", () => {
    expect(redactHeaders({ authorization: "secret", "content-type": "application/json" })).toEqual({
      authorization: "[REDACTED]",
      "content-type": "application/json",
    });
  });
});

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

describe("offline issue workflow execution", () => {
  test("getIssue resolves human issue identifiers through structured filters", async () => {
    await withMockGraphql(
      [{ issues: { nodes: [issueNode()], pageInfo: { hasNextPage: false, endCursor: null } } }],
      async (requests) => {
        const issue = await getIssue("STU-123");

        expect(issue.identifier).toBe("STU-123");
        expect(requests[0]?.variables).toEqual({ teamKey: "STU", number: 123 });
      },
    );
  });

  test("updateIssue dry-run resolves state, assignee, priority, and labels", async () => {
    await withMockGraphql(
      [
        { issues: { nodes: [issueNode()], pageInfo: { hasNextPage: false, endCursor: null } } },
        teamsResponse(),
        statesResponse(),
        usersResponse(),
        teamsResponse(),
        labelsResponse(),
      ],
      async () => {
        const result = await updateIssue("STU-123", {
          title: "New title",
          state: "Done",
          assignee: "ada@example.com",
          priority: "high",
          label: ["bug"],
        });

        expect(result.applied).toBe(false);
        expect(result.input).toMatchObject({
          title: "New title",
          stateId: "s2",
          assigneeId: "u1",
          priority: 2,
          labelIds: ["l1"],
        });
        expect(result.plannedChanges.state).toEqual({ from: "Todo", to: "Done" });
      },
    );
  });

  test("updateIssue dry-run does not plan omitted fields or no-op state changes", async () => {
    await withMockGraphql(
      [
        { issues: { nodes: [issueNode()], pageInfo: { hasNextPage: false, endCursor: null } } },
        teamsResponse(),
        statesResponse(),
      ],
      async () => {
        const result = await updateIssue("STU-123", { state: "Todo" });

        expect(result.applied).toBe(false);
        expect(result.input).toEqual({});
        expect(result.plannedChanges).toEqual({});
      },
    );
  });

  test("updateIssue dry-run resolves parent metadata without mutating", async () => {
    await withMockGraphql(
      [issueLookupResponse(), issueLookupResponse(issueNode(parentIssue))],
      async () => {
        const result = await updateIssue("STU-123", { parent: "STU-993" });

        expect(result.applied).toBe(false);
        expect(result.input).toEqual({ parentId: "parent-1" });
        expect(result.plannedChanges.parent).toEqual({ from: null, to: "STU-993" });
      },
    );
  });

  test("updateIssue dry-run can clear parent without mutating", async () => {
    await withMockGraphql([issueLookupResponse(issueNode({ parent: parentIssue }))], async () => {
      const result = await updateIssue("STU-123", { parent: "none" });

      expect(result.applied).toBe(false);
      expect(result.input).toEqual({ parentId: null });
      expect(result.plannedChanges.parent).toEqual({ from: "STU-993", to: null });
    });
  });

  test("updateIssue applies parent metadata in mutation input", async () => {
    await withMockGraphql(
      [
        issueLookupResponse(),
        issueLookupResponse(issueNode(parentIssue)),
        {
          issueUpdate: {
            success: true,
            issue: issueNode({ parent: parentIssue }),
          },
        },
      ],
      async (requests) => {
        const result = await updateIssue("STU-123", { parent: "STU-993", apply: true });

        expect(result.applied).toBe(true);
        expect(requests.at(-1)?.variables).toEqual({
          id: "i1",
          input: { parentId: "parent-1" },
        });
      },
    );
  });

  test("createIssue dry-run resolves team metadata without mutating", async () => {
    await withMockGraphql(
      [teamsResponse(), teamsResponse(), statesResponse(), teamsResponse(), labelsResponse()],
      async () => {
        const result = await createIssue({
          team: "STU",
          title: "New issue",
          description: "Body",
          state: "Todo",
          label: ["bug"],
        });

        expect(result).toEqual({
          applied: false,
          input: {
            teamId: "t1",
            title: "New issue",
            description: "Body",
            stateId: "s1",
            labelIds: ["l1"],
          },
        });
      },
    );
  });

  test("createIssue dry-run resolves project metadata without mutating", async () => {
    await withMockGraphql([teamsResponse(), projectsResponse()], async () => {
      const result = await createIssue({
        team: "STU",
        title: "New issue",
        project: "Transcriptor",
      });

      expect(result).toEqual({
        applied: false,
        input: {
          teamId: "t1",
          title: "New issue",
          projectId: "p1",
        },
      });
    });
  });

  test("createIssue dry-run resolves parent metadata without mutating", async () => {
    await withMockGraphql(
      [teamsResponse(), issueLookupResponse(issueNode(parentIssue))],
      async () => {
        const result = await createIssue({
          team: "STU",
          title: "New issue",
          parent: "STU-993",
        });

        expect(result).toEqual({
          applied: false,
          input: {
            teamId: "t1",
            title: "New issue",
            parentId: "parent-1",
          },
        });
      },
    );
  });

  test("createIssue applies parent metadata in mutation input", async () => {
    await withMockGraphql(
      [
        teamsResponse(),
        issueLookupResponse(issueNode(parentIssue)),
        {
          issueCreate: {
            success: true,
            issue: issueNode({ id: "i2", identifier: "STU-124", parent: parentIssue }),
          },
        },
      ],
      async (requests) => {
        const result = await createIssue({
          team: "STU",
          title: "New issue",
          parent: "STU-993",
          apply: true,
        });

        expect(result.applied).toBe(true);
        expect(requests.at(-1)?.variables.input).toEqual({
          teamId: "t1",
          title: "New issue",
          parentId: "parent-1",
        });
      },
    );
  });

  test("createIssue rejects parent clear references", async () => {
    await withMockGraphql([teamsResponse()], async () => {
      await expect(
        createIssue({
          team: "STU",
          title: "New issue",
          parent: "none",
        }),
      ).rejects.toThrow(ConfigError);
    });
  });

  test("createIssue rejects unknown project references", async () => {
    await withMockGraphql([teamsResponse(), projectsResponse([])], async () => {
      await expect(
        createIssue({
          team: "STU",
          title: "New issue",
          project: "Missing",
        }),
      ).rejects.toThrow(ConfigError);
    });
  });

  test("createIssue rejects ambiguous project references", async () => {
    await withMockGraphql(
      [
        teamsResponse(),
        projectsResponse([
          { id: "p1", name: "Transcriptor", state: "started" },
          { id: "p2", name: "transcriptor", state: "backlog" },
        ]),
      ],
      async () => {
        await expect(
          createIssue({
            team: "STU",
            title: "New issue",
            project: "Transcriptor",
          }),
        ).rejects.toThrow(ConfigError);
      },
    );
  });

  test("commentOnIssue dry-run reads the target issue and planned body", async () => {
    await withMockGraphql(
      [{ issues: { nodes: [issueNode()], pageInfo: { hasNextPage: false, endCursor: null } } }],
      async () => {
        const result = await commentOnIssue("STU-123", { body: "Looks good." });

        expect(result.applied).toBe(false);
        expect(result.input).toEqual({ issueId: "i1", body: "Looks good." });
      },
    );
  });
});

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
});
