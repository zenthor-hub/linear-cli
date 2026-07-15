import { executeGraphql, type ExecuteOptions } from "./client.ts";

export interface Connection<TNode> {
  nodes: TNode[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}

export interface FetchNodesOptions {
  /** Maximum number of nodes to collect. Defaults to unlimited (bounded by page guard). */
  limit?: number;
  /** Maximum pages to request. Defaults to 1000. */
  maxPages?: number;
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
  fetchOptions: FetchNodesOptions = {},
): Promise<TNode[]> {
  const limit = fetchOptions.limit;
  const maxPages = fetchOptions.maxPages ?? 1000;
  const all: TNode[] = [];
  let after: string | null = null;

  for (let page = 0; page < maxPages; page++) {
    const data = await executeGraphql<TData>(query, { ...variables, after }, options);
    const connection = extract(data);
    for (const node of connection.nodes) {
      all.push(node);
      if (limit !== undefined && all.length >= limit) {
        return all.slice(0, limit);
      }
    }
    if (!connection.pageInfo.hasNextPage || !connection.pageInfo.endCursor) break;
    after = connection.pageInfo.endCursor;
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
