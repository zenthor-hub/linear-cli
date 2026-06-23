import { executeGraphql, type ExecuteOptions } from "./client.ts";

export interface Connection<TNode> {
  nodes: TNode[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}

/**
 * Follow a relay-style connection to completion.
 *
 * The query must accept an `$after: String` variable and return a connection
 * (with `nodes` and `pageInfo`) that `extract` selects from the response.
 */
export async function fetchAllNodes<TNode, TData>(
  query: string,
  extract: (data: TData) => Connection<TNode>,
  options: ExecuteOptions,
  variables: Record<string, unknown> = {},
): Promise<TNode[]> {
  const all: TNode[] = [];
  let after: string | null = null;

  // Bounded loop guard: Linear connections are finite, but never spin forever.
  for (let page = 0; page < 1000; page++) {
    const data = await executeGraphql<TData>(query, { ...variables, after }, options);
    const connection = extract(data);
    all.push(...connection.nodes);
    if (!connection.pageInfo.hasNextPage || !connection.pageInfo.endCursor) break;
    after = connection.pageInfo.endCursor;
  }

  return all;
}
