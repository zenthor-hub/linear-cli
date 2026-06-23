# linear-cli

Agent-friendly Linear CLIs for issue workflows and administrative operations.

This repo exposes two command surfaces:

- `linear` for day-to-day issue workflow: get/search/create/update/comment, plus state and label discovery.
- `linear-admin` for administrative operations: users, teams, webhooks, and raw GraphQL.

## Goals

- Provide a narrow admin CLI for Linear administrative actions.
- Provide an agent-safe issue CLI for normal ticket work.
- Use Linear's public GraphQL API directly.
- Default bulk and destructive operations to dry-run mode.
- Produce auditable output for every mutation.
- Keep secrets outside the repository.
- Avoid duplicating MCP functionality unless it is needed for admin command composition.

## Non-goals

- Rebuild the full Linear app or MCP feature set.
- Maintain a hand-written wrapper for every Linear GraphQL type.
- Store Linear API tokens in config files committed to the repo.
- Hide GraphQL failures behind vague CLI errors.

## Linear API Basis

Linear's public API is GraphQL at:

```text
https://api.linear.app/graphql
```

Linear supports both personal API keys and OAuth2 access tokens. Personal API keys are appropriate for local personal scripts. OAuth2 is the better choice for applications or shared tooling, and the `admin` scope is required for admin-level endpoints. Linear also supports client credentials tokens for server-to-server OAuth applications when enabled for the OAuth app.

Relevant docs:

- GraphQL API: https://linear.app/developers/graphql
- OAuth2: https://linear.app/developers/oauth-2-0-authentication
- Webhooks: https://linear.app/developers/webhooks

## Command Surface

Daily issue workflow:

```bash
linear auth whoami
linear issue get STU-123
linear issue search --team STU --state "In Progress"
linear issue update STU-123 --state Done --assignee me
linear issue comment STU-123 --body-file ./comment.md
linear issue create --team STU --title "Fix import" --description-file ./body.md
linear states list --team STU
linear labels list --team STU
```

Administrative workflow:

```bash
linear-admin auth whoami
linear-admin gql ./queries/viewer.graphql --vars ./vars/viewer.json
linear-admin webhooks list
linear-admin webhooks create --url https://example.com/webhooks/linear --team TEAM_ID --resource Issue
linear-admin webhooks delete WEBHOOK_ID
linear-admin teams list
linear-admin users list --include-archived
```

Use `linear` for tickets. Use `linear-admin` for workspace/admin tasks. Keep raw GraphQL available under `linear-admin` as an escape hatch so one-off admin work does not force a permanent command.

## Safety Defaults

- `--dry-run` is the default for bulk or destructive commands.
- `--apply` is required to perform mutations with broad impact.
- Print affected entity IDs before applying a mutation.
- Require explicit IDs for deletion commands.
- Log GraphQL `errors` even when the HTTP status is `200`.
- Redact authorization headers and token values in logs.
- Support `--json` for machine-readable output.

## Authentication

Preferred local environment variables:

```bash
LINEAR_API_KEY=lin_api_...
LINEAR_ACCESS_TOKEN=...
LINEAR_CLIENT_ID=...
LINEAR_CLIENT_SECRET=...
```

Use only one request credential at a time:

- Personal API key: `Authorization: <LINEAR_API_KEY>`
- OAuth access token: `Authorization: Bearer <LINEAR_ACCESS_TOKEN>`

For shared/admin use, prefer OAuth with the smallest viable scopes. Do not request `admin` unless the command actually needs admin-level endpoints.

## Usage

```bash
bun install
cp .env.example .env   # then set LINEAR_API_KEY or LINEAR_ACCESS_TOKEN

# issue workflow
bun run linear -- issue get STU-123
bun run linear -- issue update STU-123 --state Done
bun run linear -- issue comment STU-123 --body-file ./comment.md

# admin workflow
bun run linear-admin -- webhooks list --json
bun run linear-admin -- teams list --include-archived
bun run linear-admin -- users list --admin

# mutations are dry-run by default on both entrypoints; add --apply to execute
bun run linear -- issue update STU-123 --state Done --apply
bun run linear-admin -- webhooks create --url https://example.com/hook --team TEAM_ID --resource Issue --apply
```

Quality checks:

```bash
bun run typecheck
bun test
```

Set `LINEAR_ADMIN_AUDIT_LOG=./audit.jsonl` to record one redacted JSONL line per applied mutation.

## Implementation Guide

See [docs/implementation.md](docs/implementation.md).
