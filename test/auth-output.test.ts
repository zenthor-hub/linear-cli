import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { resolveCredential } from "../src/config.ts";
import { ConfigError } from "../src/errors.ts";
import { buildAuthorizeUrl } from "../src/oauth/authorize.ts";
import { codeChallengeS256, generateCodeVerifier } from "../src/oauth/pkce.ts";
import {
  clearStoredCredentials,
  credentialsFilePath,
  loadStoredCredentials,
  profileName,
  saveOAuthSession,
} from "../src/oauth/store.ts";
import { auditMutation } from "../src/output/audit.ts";
import { redactHeaders, redactText, redactUrlSecrets } from "../src/output/redact.ts";
import { documentContainsMutation } from "../src/safety/mutation.ts";

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
