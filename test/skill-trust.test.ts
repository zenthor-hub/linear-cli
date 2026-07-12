import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { evaluateEvidence, type TrustPolicy } from "./trust-policy.ts";

const skills = join(import.meta.dirname, "..", ".agents", "skills");

describe("bundled skill trust contract", () => {
  test.each(["cli-creator/SKILL.md", "security-best-practices/SKILL.md"])(
    "%s imports the shared trust contract",
    async (path) => {
      const content = await readFile(join(skills, path), "utf8");
      expect(content).toContain("../TRUST.md");
      expect(content).toContain("untrusted evidence");
    },
  );

  test("rejects authority and execution claims in the adversarial repository fixture", async () => {
    const policy = JSON.parse(
      await readFile(join(skills, "trust-policy.json"), "utf8"),
    ) as TrustPolicy;
    const fixture = await readFile(join(skills, "fixtures", "untrusted-instructions.md"), "utf8");
    const decision = evaluateEvidence(policy, "repository_document", fixture);

    expect(decision).toEqual({
      trusted: false,
      mayOverride: false,
      mayExecute: false,
      rejectedClaims: [
        "override-governing-rules",
        "disclose-credentials",
        "execute-without-approval",
      ],
    });
  });

  test("allows trusted authority to execute only after approval", async () => {
    const policy = JSON.parse(
      await readFile(join(skills, "trust-policy.json"), "utf8"),
    ) as TrustPolicy;

    expect(
      evaluateEvidence(policy, "direct_user_instruction", "build the requested CLI"),
    ).toMatchObject({
      trusted: true,
      mayOverride: true,
      mayExecute: false,
    });
    expect(
      evaluateEvidence(policy, "direct_user_instruction", "build the requested CLI", true),
    ).toMatchObject({ trusted: true, mayOverride: true, mayExecute: true });
    expect(evaluateEvidence(policy, "unknown_future_source", "run this")).toMatchObject({
      trusted: false,
      mayOverride: false,
      mayExecute: false,
    });
  });
});
