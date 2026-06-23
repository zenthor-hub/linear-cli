import { CliError } from "../errors.ts";

/** Stable machine-readable success envelope. */
export interface SuccessEnvelope<T> {
  ok: true;
  operation: string;
  data: T;
}

/** Stable machine-readable error envelope. */
export interface ErrorEnvelope {
  ok: false;
  operation: string;
  error: {
    type: string;
    message: string;
    details?: unknown;
  };
}

export function successEnvelope<T>(operation: string, data: T): SuccessEnvelope<T> {
  return { ok: true, operation, data };
}

export function errorEnvelope(operation: string, error: unknown): ErrorEnvelope {
  if (error instanceof CliError) {
    const details = "errors" in error ? (error as { errors: unknown }).errors : undefined;
    return {
      ok: false,
      operation,
      error: { type: error.type, message: error.message, details },
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { ok: false, operation, error: { type: "Error", message } };
}

export function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

/** Minimal column-aligned table for human output. */
export function renderTable(rows: Record<string, unknown>[], columns: string[]): string {
  if (rows.length === 0) return "(no rows)";
  const widths = columns.map((col) =>
    Math.max(col.length, ...rows.map((r) => String(r[col] ?? "").length)),
  );
  const pad = (value: string, i: number) => value.padEnd(widths[i] ?? value.length);
  const header = columns.map((c, i) => pad(c, i)).join("  ");
  const sep = widths.map((w) => "-".repeat(w)).join("  ");
  const body = rows
    .map((row) => columns.map((c, i) => pad(String(row[c] ?? ""), i)).join("  "))
    .join("\n");
  return `${header}\n${sep}\n${body}`;
}
