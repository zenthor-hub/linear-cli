import { appendFileSync } from "node:fs";

import { redactForAudit, redactText } from "./redact.ts";

/**
 * Append a redacted JSONL audit record for an applied mutation.
 *
 * Opt-in: only writes when LINEAR_ADMIN_AUDIT_LOG points at a file path.
 * Decision (see implementation.md Open Questions): mutation logs are written
 * locally and gated behind an env var; shipping to a remote sink is out of scope
 * for now. Failures to write are warnings, never fatal to the command.
 */
export function auditMutation(operation: string, data: unknown, timestamp: string): void {
  const path = process.env.LINEAR_ADMIN_AUDIT_LOG?.trim();
  if (!path) return;

  const line = `${redactText(JSON.stringify({ ts: timestamp, operation, data: redactForAudit(data) }))}\n`;
  try {
    appendFileSync(path, line, { encoding: "utf8" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`warning: could not write audit log to ${path}: ${message}\n`);
  }
}

/** A result is auditable when it represents an executed (applied) mutation. */
export function isApplied(data: unknown): boolean {
  return (
    typeof data === "object" &&
    data !== null &&
    "applied" in data &&
    (data as { applied: unknown }).applied === true
  );
}
