import { parse } from "graphql";

import { ConfigError } from "../errors.ts";

/**
 * Determine whether a GraphQL document contains a mutation operation.
 *
 * Decision (see implementation.md "Resolved Decisions"): detection parses the
 * document into an AST and inspects operation definitions, rather than doing a
 * brittle substring search for the word "mutation". This avoids false positives
 * from comments, field names, or operation names.
 */
export function documentContainsMutation(source: string): boolean {
  let doc;
  try {
    doc = parse(source);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ConfigError(`Invalid GraphQL document: ${message}`);
  }
  return doc.definitions.some(
    (def) => def.kind === "OperationDefinition" && def.operation === "mutation",
  );
}
