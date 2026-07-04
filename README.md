# linear-cli

Agent-friendly Linear CLIs for issue workflows and administrative operations.

## Install

Install globally with npm:

```bash
npm install -g @zenthor-hub/linear-cli
```

This package requires Node.js 20 or newer.

Then authenticate and run commands directly:

```bash
linear auth login
linear auth whoami
linear issue get STU-123
```

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
linear auth login
linear auth whoami
linear issue get STU-123
linear issue search --team STU --state "In Progress"
linear issue update STU-123 --state Done --assignee me
linear issue update STU-123 --parent STU-993
linear issue update STU-123 --parent none
linear issue comment STU-123 --body-file ./comment.md
linear issue create --team STU --title "Fix import" --description-file ./body.md
linear issue create --team STU --project Transcriptor --title "Fix export flow"
linear issue create --team STU --parent STU-993 --title "Fix child flow"
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

### Interactive OAuth (recommended for local use)

Similar to Linear MCP login: authenticate once, then run commands without env vars.

1. Create an OAuth app at https://linear.app/settings/api/applications/new
2. Register redirect URI: `http://127.0.0.1:8787/callback`
3. Set `LINEAR_CLIENT_ID` (and optionally `LINEAR_CLIENT_SECRET`) in `.env`
4. Log in:

```bash
npm run linear -- auth login
npm run linear-admin -- auth login   # defaults to read,admin scope
npm run linear -- auth status --json
npm run linear -- auth logout
```

Credentials are stored at `~/.config/linear-cli/credentials.json` (override with `LINEAR_CREDENTIALS_FILE`). Access tokens refresh automatically.

### Environment variables (CI, scripting, overrides)

```bash
LINEAR_API_KEY=lin_api_...
LINEAR_ACCESS_TOKEN=...
LINEAR_CLIENT_ID=...
LINEAR_CLIENT_SECRET=...
```

Use only one request credential at a time via env:

- Personal API key: `Authorization: <LINEAR_API_KEY>`
- OAuth access token: `Authorization: Bearer <LINEAR_ACCESS_TOKEN>`

Env credentials take precedence over the stored OAuth session.

### Headless client credentials (`linear-admin`)

For CI or server use, enable client credentials on the OAuth app, then:

```bash
LINEAR_OAUTH_GRANT=client_credentials
LINEAR_OAUTH_SCOPE=read,admin
npm run linear-admin -- auth token --scope read,admin --print-env
```

Or fetch a token inline:

```bash
npm run linear-admin -- webhooks list --json
```

For shared/admin use, prefer OAuth with the smallest viable scopes. Do not request `admin` unless the command actually needs admin-level endpoints.

## Usage

For local development:

```bash
npm install
cp .env.example .env   # then set LINEAR_API_KEY or LINEAR_ACCESS_TOKEN

# issue workflow
npm run linear -- issue get STU-123
npm run linear -- issue update STU-123 --state Done
npm run linear -- issue update STU-123 --parent STU-993
npm run linear -- issue update STU-123 --parent none
npm run linear -- issue comment STU-123 --body-file ./comment.md
npm run linear -- issue create --team STU --project Transcriptor --title "Fix export flow"
npm run linear -- issue create --team STU --parent STU-993 --title "Fix child flow"

# admin workflow
npm run linear-admin -- webhooks list --json
npm run linear-admin -- teams list --include-archived
npm run linear-admin -- users list --admin

# mutations are dry-run by default on both entrypoints; add --apply to execute
npm run linear -- issue update STU-123 --state Done --apply
npm run linear-admin -- webhooks create --url https://example.com/hook --team TEAM_ID --resource Issue --apply
```

Quality checks:

```bash
npm run build
npm run typecheck
npm test
npm run smoke:global-install
```

Set `LINEAR_ADMIN_AUDIT_LOG=./audit.jsonl` to record one redacted JSONL line per applied mutation.

## Implementation Guide

See [docs/implementation.md](docs/implementation.md).
