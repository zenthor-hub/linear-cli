export function mockFetch(
  fn: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>,
): typeof fetch {
  return Object.assign(fn, { preconnect: () => undefined });
}

export async function withMockGraphql<T>(
  responses: unknown[],
  body: (requests: Array<{ query: string; variables: Record<string, unknown> }>) => Promise<T>,
): Promise<T> {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.LINEAR_API_KEY;
  const requests: Array<{ query: string; variables: Record<string, unknown> }> = [];

  process.env.LINEAR_API_KEY = "lin_api_test";
  globalThis.fetch = mockFetch(async (_url, init) => {
    requests.push(
      JSON.parse(String(init?.body)) as { query: string; variables: Record<string, unknown> },
    );
    const response = responses.shift();
    if (response === undefined) {
      return new Response(JSON.stringify({ errors: [{ message: "Unexpected mock request" }] }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ data: response }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  try {
    return await body(requests);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) {
      delete process.env.LINEAR_API_KEY;
    } else {
      process.env.LINEAR_API_KEY = originalApiKey;
    }
  }
}

export const teamNode = { id: "t1", key: "STU", name: "Studio", private: false, archivedAt: null };
export const stateTodo = { id: "s1", name: "Todo", type: "unstarted", position: 1, team: teamNode };
export const stateDone = { id: "s2", name: "Done", type: "completed", position: 2, team: teamNode };
export const userAda = {
  id: "u1",
  name: "Ada",
  email: "ada@example.com",
  active: true,
  admin: false,
  archivedAt: null,
};

export const parentIssue = {
  id: "parent-1",
  identifier: "STU-993",
  title: "Parent issue",
  url: "https://linear.app/mirelo/issue/STU-993/parent-issue",
};

export function issueNode(overrides: Record<string, unknown> = {}) {
  return {
    id: "i1",
    identifier: "STU-123",
    number: 123,
    title: "Old title",
    description: "Old description",
    priority: 3,
    priorityLabel: "Normal",
    url: "https://linear.app/mirelo/issue/STU-123/old-title",
    branchName: "stu-123-old-title",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    team: { id: teamNode.id, key: teamNode.key, name: teamNode.name },
    state: { id: stateTodo.id, name: stateTodo.name, type: stateTodo.type },
    assignee: null,
    labels: { nodes: [] },
    project: null,
    parent: null,
    ...overrides,
  };
}

export function issueLookupResponse(issue = issueNode()) {
  return { issues: { nodes: [issue], pageInfo: { hasNextPage: false, endCursor: null } } };
}

export function teamsResponse() {
  return { teams: { nodes: [teamNode], pageInfo: { hasNextPage: false, endCursor: null } } };
}

export function usersResponse() {
  return { users: { nodes: [userAda], pageInfo: { hasNextPage: false, endCursor: null } } };
}

export function statesResponse() {
  return {
    workflowStates: {
      nodes: [stateTodo, stateDone],
      pageInfo: { hasNextPage: false, endCursor: null },
    },
  };
}

export function labelsResponse() {
  return {
    issueLabels: {
      nodes: [
        {
          id: "l1",
          name: "bug",
          color: "#ff0000",
          team: { id: teamNode.id, key: teamNode.key, name: teamNode.name },
        },
      ],
      pageInfo: { hasNextPage: false, endCursor: null },
    },
  };
}

export function projectsResponse(
  nodes: unknown[] = [{ id: "p1", name: "Transcriptor", state: "started" }],
) {
  return {
    projects: {
      nodes,
      pageInfo: { hasNextPage: false, endCursor: null },
    },
  };
}
