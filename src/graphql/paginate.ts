import { ConfigError } from "../errors.ts";
import { executeGraphql, type ExecuteOptions } from "./client.ts";

export interface Connection<TNode> {
  nodes: TNode[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}

export interface FetchNodesOptions<TNode = unknown> {
  /** Maximum number of nodes to collect. Defaults to unlimited (bounded by page guard). */
  limit?: number;
  /** Maximum pages to request. Defaults to 1000. */
  maxPages?: number;
  /**
   * When set, only matching nodes are collected and count toward `limit`.
   * Non-matching nodes are skipped (useful for client-side filters).
   */
  match?: (node: TNode) => boolean;
  /**
   * When pagination stops because `maxPages` was hit while more data remains
   * and `limit` is not yet filled, throw a ConfigError with this message
   * (or a message built from the number of matches collected so far).
   */
  maxPagesExceededMessage?: string | ((collected: number) => string);
}

/**
 * Follow a relay-style connection until exhausted or `limit` is reached.
 *
 * The query must accept an `$after: String` variable and return a connection
 * (with `nodes` and `pageInfo`) that `extract` selects from the response.
 */
export async function fetchNodes<TNode, TData>(
  query: string,
  extract: (data: TData) => Connection<TNode>,
  options: ExecuteOptions,
  variables: Record<string, unknown> = {},
  fetchOptions: FetchNodesOptions<TNode> = {},
): Promise<TNode[]> {
  const limit = fetchOptions.limit;
  const maxPages = fetchOptions.maxPages ?? 1000;
  const match = fetchOptions.match;
  const all: TNode[] = [];
  let after: string | null = null;

  for (let page = 0; page < maxPages; page++) {
    const data = await executeGraphql<TData>(query, { ...variables, after }, options);
    const connection = extract(data);
    for (const node of connection.nodes) {
      if (match && !match(node)) continue;
      all.push(node);
      if (limit !== undefined && all.length >= limit) {
        return all.slice(0, limit);
      }
    }
    if (!connection.pageInfo.hasNextPage || !connection.pageInfo.endCursor) {
      return all;
    }
    after = connection.pageInfo.endCursor;
  }

  // Loop exhausted maxPages with a next page still pending → hit the page cap
  // before `limit` was filled (an already-filled limit would have returned above).
  if (fetchOptions.maxPagesExceededMessage) {
    const message =
      typeof fetchOptions.maxPagesExceededMessage === "function"
        ? fetchOptions.maxPagesExceededMessage(all.length)
        : fetchOptions.maxPagesExceededMessage;
    throw new ConfigError(message);
  }
  return all;
}

/**
 * Follow a relay-style connection to completion.
 */
export async function fetchAllNodes<TNode, TData>(
  query: string,
  extract: (data: TData) => Connection<TNode>,
  options: ExecuteOptions,
  variables: Record<string, unknown> = {},
): Promise<TNode[]> {
  return fetchNodes(query, extract, options, variables);
}
