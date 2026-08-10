import { readFile } from "node:fs/promises";
import { extname } from "node:path";

import { resolveCredential } from "../config.ts";
import { ConfigError } from "../errors.ts";
import { executeGraphql } from "../graphql/client.ts";
import { validateGraphqlDocument, type GraphqlOperationType } from "../graphql/validation.ts";
import { redactForAudit } from "../output/redact.ts";

export interface GqlOptions {
  vars?: string;
  schema?: string;
  apply?: boolean;
  debug?: boolean;
}

export interface GqlData {
  isMutation: boolean;
  applied: boolean;
  result: unknown;
  operationName?: string | null;
  operationNames?: string[];
  operationType?: GraphqlOperationType | "multiple";
  schemaValidated?: boolean;
  variables?: Record<string, unknown>;
}

function redactVariables(variables: Record<string, unknown>): Record<string, unknown> {
  return redactForAudit(variables) as Record<string, unknown>;
}

async function readDocument(input: string): Promise<string> {
  if (input === "-") {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      }
      return Buffer.concat(chunks).toString("utf8");
    } catch {
      throw new ConfigError("Could not read GraphQL document from stdin.");
    }
  }
  if (extname(input) !== ".graphql") {
    throw new ConfigError(`GraphQL document must be a .graphql file (got: ${input})`);
  }
  return readFile(input, "utf8").catch(() => {
    throw new ConfigError(`Could not read GraphQL file: ${input}`);
  });
}

/**
 * Run an explicit GraphQL document from a `.graphql` file or stdin (`-`).
 *
 * Decision: every mutation is dry-run by default; `--apply` is required to
 * execute one. Queries always execute (they have no side effects).
 */
export async function runGql(file: string, options: GqlOptions): Promise<GqlData> {
  const source = await readDocument(file);

  let variables: Record<string, unknown> = {};
  if (options.vars) {
    if (extname(options.vars) !== ".json") {
      throw new ConfigError(`Variables file must be JSON (got: ${options.vars})`);
    }
    const raw = await readFile(options.vars, "utf8").catch(() => {
      throw new ConfigError(`Could not read variables file: ${options.vars}`);
    });
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("variables must be a JSON object");
      }
      variables = parsed as Record<string, unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new ConfigError(`Variables file is not valid JSON: ${message}`);
    }
  }

  const parsed = await validateGraphqlDocument(source, options.schema);
  const isMutation = parsed.isMutation;

  if (parsed.operationNames.length > 1 && (options.apply || !isMutation)) {
    throw new ConfigError(
      `GraphQL document contains multiple operations (${parsed.operationNames.join(", ") || "including anonymous operation"}); use one operation per document.`,
    );
  }

  if (isMutation && !options.apply) {
    return {
      isMutation,
      applied: false,
      result: null,
      operationName: parsed.operationName,
      operationNames: parsed.operationNames,
      operationType: parsed.operationType,
      schemaValidated: parsed.schemaValidated,
      variables: redactVariables(variables),
    };
  }

  const credential = await resolveCredential();
  const result = await executeGraphql<unknown>(source, variables, {
    credential,
    debug: options.debug,
  });

  return { isMutation, applied: isMutation, result };
}
