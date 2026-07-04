# Linear Admin CLI Implementation

## Decision

Build a focused admin CLI named `linear-admin`. The MCP already covers common product workflows, so this CLI should exist only for unsupported administrative actions, deterministic automation, bulk operations, and raw GraphQL access.

The implementation should use Linear's public GraphQL API directly, with the official TypeScript SDK where it improves type safety. Keep direct GraphQL execution available because admin surfaces can move faster than a curated SDK or MCP wrapper.

## Reference API Behavior

Linear exposes a GraphQL endpoint:

```text
https://api.linear.app/graphql
```

The API supports schema introspection, standard GraphQL errors, personal API keys, and OAuth2 access tokens. GraphQL responses can include an `errors` array even when the HTTP status is successful, so the client must treat GraphQL errors as first-class failures.

Authentication headers:

```text
Authorization: <PERSONAL_API_KEY>
Authorization: Bearer <OAUTH_ACCESS_TOKEN>
```

OAuth supports scopes including `read`, `write`, narrower create scopes, and `admin`. The `admin` scope should be requested only for commands that need admin-level endpoints.

Webhooks are organization-level resources. Linear documents that only workspace admins, or OAuth applications with the `admin` scope, can create or read webhooks. Webhook creation can be done through the `webhookCreate` mutation; listing can query `webhooks`; deletion uses `webhookDelete`.

## Architecture

Use a small TypeScript Node CLI:

```text
src/
  cli.ts
  config.ts
  graphql/
    client.ts
    execute.ts
    documents.ts
  commands/
    auth.ts
    gql.ts
    teams.ts
    users.ts
    webhooks.ts
  output/
    format.ts
    redact.ts
  safety/
    confirmation.ts
    dry-run.ts
```

Recommended packages:

```bash
npm install @linear/sdk commander zod
npm install --save-dev typescript @types/node tsx esbuild vitest
```

Use `commander` for CLI parsing, `zod` for validating command options and GraphQL variables, and `@linear/sdk` where the SDK covers the command cleanly. Use a direct `fetch` GraphQL client for operations that are missing, awkward, or newly added.

## Command Design

### `auth whoami`

Purpose: verify credentials and show the authenticated user/workspace context.

GraphQL:

```graphql
query Viewer {
  viewer {
    id
    name
    email
  }
  organization {
    id
    name
    urlKey
  }
}
```

Output:

```text
Authenticated as Grace Hopper <grace@example.com>
Organization: Example Co (example)
```

### `gql`

Purpose: run explicit GraphQL query or mutation files for one-off admin work.

Example:

```bash
linear-admin gql ./queries/webhooks.graphql --vars ./vars/prod.json --json
```

Rules:

- Accept `.graphql` files only.
- Variables must be JSON.
- Print GraphQL errors and exit non-zero.
- Redact tokens in debug output.
- Require `--apply` for mutations unless `--unsafe-allow-mutation` is explicitly configured for a local session.

Mutation detection can be conservative: if the document contains `mutation`, require `--apply`.

### `webhooks list`

Purpose: inspect organization webhooks.

GraphQL:

```graphql
query Webhooks {
  webhooks {
    nodes {
      id
      url
      enabled
      resourceTypes
      team {
        id
        name
      }
      creator {
        id
        name
      }
    }
  }
}
```

### `webhooks create`

Purpose: create a webhook for all public teams or a specific team.

Example:

```bash
linear-admin webhooks create \
  --url https://example.com/webhooks/linear \
  --team 72b2a2dc-6f4f-4423-9d34-24b5bd10634a \
  --resource Issue \
  --resource Comment \
  --apply
```

GraphQL:

```graphql
mutation WebhookCreate($input: WebhookCreateInput!) {
  webhookCreate(input: $input) {
    success
    webhook {
      id
      enabled
      url
    }
  }
}
```

Safety:

- Default to dry-run and print the intended input.
- Require HTTPS URLs.
- Reject localhost URLs for persistent webhooks.
- Require either `--team` or `--all-public-teams`.

### `webhooks delete`

Purpose: remove an existing webhook.

Example:

```bash
linear-admin webhooks delete 1087f03a-180a-4c31-b7dc-03dbe761ff59 --apply
```

GraphQL:

```graphql
mutation WebhookDelete($id: String!) {
  webhookDelete(id: $id) {
    success
  }
}
```

Safety:

- Require exact webhook ID.
- In dry-run, fetch and print the webhook first.
- Require `--apply`.

### `teams list`

Purpose: discover team IDs for admin commands.

GraphQL:

```graphql
query Teams {
  teams {
    nodes {
      id
      key
      name
      private
      archivedAt
    }
  }
}
```

### `users list`

Purpose: inspect users for access and ownership audits.

GraphQL:

```graphql
query Users {
  users {
    nodes {
      id
      name
      email
      active
      admin
      archivedAt
    }
  }
}
```

Confirm these exact fields against schema introspection during implementation; Linear's schema is the source of truth.

## GraphQL Client Contract

The shared executor should:

1. Send `POST` requests to `https://api.linear.app/graphql`.
2. Set `Content-Type: application/json`.
3. Add exactly one supported authorization header.
4. Parse JSON responses.
5. Throw a typed error on non-2xx HTTP status.
6. Throw a typed error when `errors` is present.
7. Return `data` only after error checks pass.
8. Support `--debug` with redacted headers.

Pseudo-code:

```ts
type GraphqlResponse<T> = {
  data?: T;
  errors?: Array<{ message: string; path?: string[]; extensions?: unknown }>;
};

export async function executeGraphql<T>(
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const response = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: getAuthorizationHeader(),
    },
    body: JSON.stringify({ query, variables }),
  });

  const body = (await response.json()) as GraphqlResponse<T>;

  if (!response.ok) {
    throw new LinearHttpError(response.status, body);
  }

  if (body.errors?.length) {
    throw new LinearGraphqlError(body.errors, body.data);
  }

  if (!body.data) {
    throw new LinearGraphqlError([{ message: "Missing GraphQL data" }], body);
  }

  return body.data;
}
```

## Dry-run and Apply Model

Default behavior:

```bash
linear-admin webhooks delete WEBHOOK_ID
# prints planned deletion, exits without mutation
```

Mutation behavior:

```bash
linear-admin webhooks delete WEBHOOK_ID --apply
# executes mutation
```

For bulk mutations:

- Require a preview query.
- Print count and IDs.
- Refuse to apply if the affected count is zero unless `--allow-empty`.
- Refuse to apply if the affected count exceeds `--max N`.

## Output

Default output should be human-readable tables or concise summaries.

Machine-readable output:

```bash
linear-admin webhooks list --json
```

Use stable JSON envelopes:

```json
{
  "ok": true,
  "operation": "webhooks.list",
  "data": []
}
```

Errors:

```json
{
  "ok": false,
  "operation": "webhooks.list",
  "error": {
    "type": "LinearGraphqlError",
    "message": "Field does not exist on type Webhook",
    "details": []
  }
}
```

## Secret Handling

Do not write tokens into repository files.

Read credentials in this order:

1. `LINEAR_ACCESS_TOKEN`
2. `LINEAR_API_KEY`
3. Optional future keychain or 1Password lookup

Never print:

- `LINEAR_API_KEY`
- `LINEAR_ACCESS_TOKEN`
- OAuth refresh tokens
- Authorization headers
- Webhook signing secrets

## Webhook Consumer Notes

The CLI can manage Linear webhook registrations, but webhook delivery verification belongs in the receiving service.

Webhook consumers should:

- Use a public HTTPS endpoint.
- Respond with HTTP 200 within Linear's timeout.
- Verify `Linear-Signature` with the raw request body.
- Check webhook timestamps to reduce replay risk.
- Treat payloads as event notifications and refetch source data when exact current state matters.

## Testing Strategy

Unit tests:

- GraphQL executor handles HTTP errors.
- GraphQL executor handles `errors` with HTTP 200.
- Auth header selection rejects ambiguous credentials.
- Dry-run prevents mutations.
- `--apply` permits mutations.
- Output redaction removes token-like values.

Integration tests:

- `auth whoami` against a real test workspace.
- `teams list` against a real test workspace.
- `webhooks list` with an admin-scoped token.

Mutation tests should run only against a dedicated Linear test workspace.

## Implementation Phases

### Phase 1: CLI skeleton

- Add TypeScript/Node project setup.
- Implement `config`, `executeGraphql`, `format`, and redaction helpers.
- Add `auth whoami`.
- Add raw `gql` command for query files.

### Phase 2: Webhook admin

- Add `webhooks list`.
- Add `webhooks create`.
- Add `webhooks delete`.
- Add dry-run/apply enforcement.

### Phase 3: Audit commands

- Add `teams list`.
- Add `users list`.
- Add JSON output and filtering.

### Phase 4: Operational hardening

- Add structured logs.
- Add tests.
- Add schema introspection/codegen if repeated GraphQL drift becomes a problem.
- Add OAuth flow only if personal API keys are not sufficient for the operational workflow.

## Resolved Decisions

These were ambiguous or contradictory in the original plan and are now fixed in the Phase 1 implementation:

1. **Credential selection rejects ambiguity.** If both `LINEAR_ACCESS_TOKEN` and `LINEAR_API_KEY` are set, the CLI errors instead of silently preferring one (avoids acting under the wrong identity). Exactly one must be present. (`src/config.ts`)
2. **All mutations are dry-run by default.** Not just "destructive" ones. Any mutation requires `--apply`; queries always execute since they have no side effects. The `--unsafe-allow-mutation` flag from the original draft is dropped.
3. **Mutation detection is AST-based.** The `gql` command parses the document and inspects operation definitions rather than substring-matching the word `mutation`, eliminating false positives from comments/field names. (`src/safety/mutation.ts`)
4. **OAuth login is implemented.** PKCE browser login (`auth login`), local credential store, automatic refresh, client-credentials for headless use, and env overrides (`LINEAR_API_KEY`, `LINEAR_ACCESS_TOKEN`) remain supported.

**Exit-code contract:** `0` success; `2` for config/usage/credential errors; `1` for HTTP/GraphQL/other runtime failures. `--json` output still exits non-zero on error.

### Deferred to later phases (captured, not yet implemented)

- **Pagination:** ✅ implemented in Phase 2 via `src/graphql/paginate.ts` (`fetchAllNodes`), used by `webhooks`, `teams`, and `users` lists.
- **`users list --include-archived`:** ✅ implemented in Phase 3 (plus `teams list --include-archived`).
- **Rate limiting/retries:** ✅ implemented in Phase 4 — `executeGraphql` retries HTTP 429/5xx with `Retry-After`-aware capped exponential backoff (`src/graphql/retry.ts`).
- **Bulk-safety flags** (`--max N`, `--allow-empty`) are specified but currently orphaned; they attach to the first bulk command.

### Audit logging

Set `LINEAR_ADMIN_AUDIT_LOG=/path/to/audit.jsonl` to append one redacted JSONL record per **applied** mutation (`webhooks create/delete --apply`, `gql` mutations with `--apply`). Dry-runs are never logged. Tokens are redacted before writing. Remote/audit-sink shipping remains out of scope.

## Implementation Status

- **Phase 1 (CLI skeleton):** ✅ `config`, `executeGraphql`, output/redaction, `auth whoami`, raw `gql`.
- **Phase 2 (Webhook admin):** ✅ `webhooks list/create/delete`, pagination helper, dry-run/apply enforcement, HTTPS/localhost/scope validation.
- **Phase 3 (Audit commands):** ✅ `teams list` (`--include-archived`, `--private`/`--public`), `users list` (`--include-archived`, `--admin`, `--active`/`--inactive`), JSON output.
- **Phase 4 (Hardening):** ✅ retry/backoff for rate limits, opt-in local audit logging, unit tests across all layers.
- **Phase 5 (OAuth):** ✅ PKCE `auth login/logout/status`, stored credentials with refresh, client-credentials `auth token`, 401 retry, env precedence preserved. ⏳ Still conditional: schema introspection/codegen and keychain backend.

## Open Questions

- Which exact administrative actions are required first?
- Will this run only locally, or also in CI?
- Is a personal admin API key acceptable, or should this use OAuth with `admin` scope?
- Do we need webhook registration only, or also webhook delivery diagnostics?
- Should mutation logs be written locally, shipped to an audit sink, or both?
