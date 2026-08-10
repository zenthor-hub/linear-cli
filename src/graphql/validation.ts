import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { buildASTSchema, parse, validate, type DocumentNode } from "graphql";

import { ConfigError } from "../errors.ts";

export type GraphqlOperationType = "query" | "mutation" | "subscription";

export interface ParsedGraphqlDocument {
  document: DocumentNode;
  isMutation: boolean;
  operationName: string | null;
  operationNames: string[];
  operationType: GraphqlOperationType | "multiple";
  schemaValidated: boolean;
}

/** Parse a raw document and describe its executable operations without making a request. */
export function parseGraphqlDocument(source: string): {
  document: DocumentNode;
  isMutation: boolean;
  operationName: string | null;
  operationNames: string[];
  operationType: GraphqlOperationType | "multiple";
} {
  let document: DocumentNode;
  try {
    document = parse(source);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ConfigError(`Invalid GraphQL document: ${message}`);
  }

  const operations = document.definitions.filter(
    (definition): definition is Extract<typeof definition, { kind: "OperationDefinition" }> =>
      definition.kind === "OperationDefinition",
  );
  if (operations.length === 0) {
    throw new ConfigError(
      "GraphQL document must contain at least one query, mutation, or subscription.",
    );
  }

  const operationNames = operations.flatMap((operation) =>
    operation.name?.value ? [operation.name.value] : [],
  );
  const first = operations[0];
  const operationType =
    operations.length === 1 ? (first?.operation as GraphqlOperationType) : "multiple";
  return {
    document,
    isMutation: operations.some((operation) => operation.operation === "mutation"),
    operationName: operations.length === 1 ? (first?.name?.value ?? null) : null,
    operationNames,
    operationType,
  };
}

async function loadConfiguredSchema(schemaPath?: string) {
  let configuredPath =
    schemaPath?.trim() ||
    process.env.LINEAR_SCHEMA_PATH?.trim() ||
    process.env.SCHEMA_PATH?.trim() ||
    process.env.LINEAR_SCHEMA_CACHE?.trim();
  let source: string;
  if (!configuredPath) {
    configuredPath = resolve(process.cwd(), ".cache/linear-schema.graphql");
    source = await readFile(configuredPath, "utf8").catch(() => "");
    if (!source) return null;
  } else {
    source = await readFile(configuredPath, "utf8").catch(() => {
      throw new ConfigError(`Could not read GraphQL schema file: ${configuredPath}`);
    });
  }

  try {
    return buildASTSchema(parse(source));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ConfigError(`GraphQL schema is not valid: ${message}`);
  }
}

/**
 * Validate syntax always and validate against a configured schema or the
 * repository's cached `.cache/linear-schema.graphql` when it is available.
 */
export async function validateGraphqlDocument(
  source: string,
  schemaPath?: string,
): Promise<ParsedGraphqlDocument> {
  const parsed = parseGraphqlDocument(source);
  const schema = await loadConfiguredSchema(schemaPath);
  if (!schema) return { ...parsed, schemaValidated: false };

  const errors = validate(schema, parsed.document);
  if (errors.length > 0) {
    throw new ConfigError(
      `GraphQL document failed schema validation:\n${errors.map((error) => `- ${error.message}`).join("\n")}`,
    );
  }
  return { ...parsed, schemaValidated: true };
}
