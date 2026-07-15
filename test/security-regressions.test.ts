import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test, vi } from "vitest";

import { authLogout } from "../src/commands/auth.ts";
import { resolveCredential } from "../src/config.ts";
import { LinearHttpError } from "../src/errors.ts";
import { executeGraphql } from "../src/graphql/client.ts";
import { loadStoredCredentials, saveOAuthSession } from "../src/oauth/store.ts";

function mockFetch(
  fn: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>,
): typeof fetch {
  return Object.assign(fn, { preconnect: () => undefined });
}

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

describe("GraphQL retry safety", () => {
  const credential = {
    kind: "apiKey" as const,
    authorizationHeader: "lin_api_test",
    raw: "lin_api_test",
    source: "apiKey" as const,
  };

  test("does not replay a mutation after a retryable HTTP response", async () => {
    const requests: RequestInit[] = [];
    globalThis.fetch = mockFetch(async (_url, init) => {
      requests.push(init ?? {});
      return new Response(JSON.stringify({ errors: [{ message: "transient" }] }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    });

    await expect(
      executeGraphql(
        'mutation Create { issueCreate(input: { title: "x" }) { success } }',
        {},
        {
          credential,
        },
      ),
    ).rejects.toBeInstanceOf(LinearHttpError);
    expect(requests).toHaveLength(1);
  });

  test("continues to retry idempotent queries", async () => {
    let requests = 0;
    globalThis.fetch = mockFetch(async () => {
      requests += 1;
      if (requests === 1) {
        return new Response(JSON.stringify({ errors: [{ message: "transient" }] }), {
          status: 503,
          headers: { "content-type": "application/json", "retry-after": "0" },
        });
      }
      return new Response(JSON.stringify({ data: { viewer: { id: "u1" } } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    await expect(
      executeGraphql<{ viewer: { id: string } }>(
        "query Viewer { viewer { id } }",
        {},
        {
          credential,
        },
      ),
    ).resolves.toEqual({ viewer: { id: "u1" } });
    expect(requests).toBe(2);
  });

  test("structurally redacts nested debug variables", async () => {
    globalThis.fetch = mockFetch(
      async () => new Response(JSON.stringify({ data: { viewer: { id: "u1" } } })),
    );
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await executeGraphql(
      "query Viewer { viewer { id } }",
      {
        input: {
          password: "plain",
          clientSecret: "client",
          items: [{ apiKey: "key" }],
          note: "opaque-active-credential",
        },
      },
      {
        credential: {
          ...credential,
          authorizationHeader: "opaque-active-credential",
          raw: "opaque-active-credential",
        },
        debug: true,
      },
    );

    const output = stderr.mock.calls.map(([value]) => String(value)).join("");
    expect(output).not.toContain("plain");
    expect(output).not.toContain(':"client"');
    expect(output).not.toContain(':"key"');
    expect(output).not.toContain("opaque-active-credential");
    expect(output.match(/\[REDACTED\]/g)?.length).toBeGreaterThanOrEqual(3);
  });
});

describe("OAuth logout lifecycle", () => {
  async function storedSession() {
    const dir = await mkdtemp(join(tmpdir(), "linear-cli-logout-"));
    process.env.LINEAR_CREDENTIALS_FILE = join(dir, "credentials.json");
    delete process.env.LINEAR_CLIENT_ID;
    await saveOAuthSession({
      kind: "oauth",
      accessToken: "access",
      refreshToken: "refresh",
      expiresAt: Date.now() + 60_000,
      scope: "read",
      tokenType: "Bearer",
      clientId: "stored-client",
    });
    return dir;
  }

  test("uses stored client metadata and clears only after successful revocation", async () => {
    const dir = await storedSession();
    const bodies: string[] = [];
    globalThis.fetch = mockFetch(async (_url, init) => {
      bodies.push(String(init?.body));
      return new Response(null, { status: 200 });
    });

    try {
      await expect(authLogout({})).resolves.toEqual({
        status: "cleared",
        cleared: true,
        revocation: "revoked",
      });
      expect(bodies).toHaveLength(2);
      expect(bodies.every((body) => body.includes("client_id=stored-client"))).toBe(true);
      expect(await loadStoredCredentials()).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("retains credentials and reports an unsuccessful revocation", async () => {
    const dir = await storedSession();
    globalThis.fetch = mockFetch(async () => new Response(null, { status: 503 }));

    try {
      await expect(authLogout({})).resolves.toEqual({
        status: "revocation_failed",
        cleared: false,
        revocation: "failed",
        errors: [
          "OAuth token revocation failed (HTTP 503).",
          "OAuth token revocation failed (HTTP 503).",
        ],
      });
      expect(await loadStoredCredentials()).not.toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("reports partial revocation without deleting the recoverable session", async () => {
    const dir = await storedSession();
    let requests = 0;
    globalThis.fetch = mockFetch(async () => {
      requests += 1;
      return new Response(null, { status: requests === 1 ? 200 : 503 });
    });

    try {
      await expect(authLogout({})).resolves.toEqual({
        status: "revocation_failed",
        cleared: false,
        revocation: "partial",
        errors: ["OAuth token revocation failed (HTTP 503)."],
      });
      expect(await loadStoredCredentials()).not.toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a refresh waiting behind logout cannot recreate deleted credentials", async () => {
    const dir = await storedSession();
    let releaseRevocation!: () => void;
    const revocationStarted = new Promise<void>((resolve) => {
      releaseRevocation = resolve;
    });
    let notifyStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    globalThis.fetch = mockFetch(async (url) => {
      if (String(url).includes("revoke")) {
        notifyStarted();
        await revocationStarted;
        return new Response(null, { status: 200 });
      }
      return new Response(
        JSON.stringify({
          access_token: "new-access",
          refresh_token: "new-refresh",
          expires_in: 3600,
          scope: "read",
          token_type: "Bearer",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    try {
      // Env credentials take precedence; clear them so this exercises the stored session path.
      delete process.env.LINEAR_API_KEY;
      delete process.env.LINEAR_ACCESS_TOKEN;
      const logout = authLogout({});
      await started;
      process.env.LINEAR_CLIENT_ID = "stored-client";
      const refresh = resolveCredential({ forceRefresh: true });
      await expect(refresh).rejects.toThrow("logout is already in progress");
      releaseRevocation();
      await logout;
      expect(await loadStoredCredentials()).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("recovers a stale logout marker left by a terminated process", async () => {
    const dir = await storedSession();
    const marker = `${process.env.LINEAR_CREDENTIALS_FILE}.logout`;
    await writeFile(marker, `${JSON.stringify({ pid: 2_147_483_647 })}\n`, "utf8");

    try {
      await expect(loadStoredCredentials()).resolves.toMatchObject({ accessToken: "access" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
