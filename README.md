# linear-cli

[![CI](https://github.com/zenthor-hub/linear-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/zenthor-hub/linear-cli/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@zenthor-hub/linear-cli.svg)](https://www.npmjs.com/package/@zenthor-hub/linear-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Agent-friendly Linear CLIs for issue workflows and administrative operations.

> **Disclaimer:** This is an unofficial, community-maintained project by [zenthor-hub](https://github.com/zenthor-hub). It is not published, endorsed, or supported by Linear (Linear Orbit, Inc.). This project is not affiliated with or sponsored by Linear. "Linear" is a trademark of Linear Orbit, Inc.

## Install

Install globally with Bun:

```bash
bun install -g @zenthor-hub/linear-cli
```

This package requires Node.js 22.12 or newer.

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
linear issue search --team STU --state "In Progress" --limit 25
linear issue search --query "export flow" --team STU
linear issue update STU-123 --state Done --assignee me
linear issue update STU-123 --project Transcriptor --cycle active --due-date 2026-03-01
linear issue update STU-123 --add-label bug --remove-label wontfix
linear issue update STU-123 --parent STU-993
linear issue update STU-123 --parent none
linear issue comment STU-123 --body-file ./comment.md
linear issue comments STU-123
linear issue create --team STU --title "Fix import" --description-file ./body.md
linear issue create --team STU --project Transcriptor --cycle active --title "Fix export flow"
linear issue create --team STU --parent STU-993 --title "Fix child flow"
linear issue archive STU-123
linear issue relation list STU-123
linear issue relation create STU-123 --type blocks --related STU-124
linear project list --team STU
linear project get Transcriptor
linear cycle list --team STU --only active
linear states list --team STU
linear labels list --team STU
```

Administrative workflow:

```bash
linear-admin auth whoami
linear-admin gql ./queries/viewer.graphql --vars ./vars/viewer.json
linear-admin webhooks list
linear-admin webhooks create --url https://example.com/webhooks/linear --team TEAM_ID --resource Issue
linear-admin webhooks update WEBHOOK_ID --label production --enabled
linear-admin webhooks rotate-secret WEBHOOK_ID
linear-admin webhooks delete WEBHOOK_ID
linear-admin teams list
linear-admin users list --include-archived
```

Use `linear` for tickets. Use `linear-admin` for workspace/admin tasks. Keep raw GraphQL available under `linear-admin` as an escape hatch so one-off admin work does not force a permanent command.

### Coverage note

This CLI is intentionally **not** a full Linear API client. Linear’s public schema exposes hundreds of queries/mutations (initiatives, documents, customers, releases, integrations, notifications, etc.). The curated commands cover agent/admin workflows above; everything else should use `linear-admin gql`. Mutations default to dry-run and require `--apply`.

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
bun run linear -- auth login
bun run linear-admin -- auth login   # defaults to read,admin scope
bun run linear -- auth status --json
bun run linear -- auth logout
```

Credentials are stored at `~/.config/linear-cli/credentials.json` (override with `LINEAR_CREDENTIALS_FILE`). Access tokens refresh automatically.

### Named credential profiles (opt-in)

Use named profiles when you need to work with more than one Linear workspace. This does not change the existing authentication behavior: commands without `--profile` continue to use environment credentials and the legacy credentials file exactly as before.

```bash
# OAuth profile; complete the browser login for the intended workspace.
bun run linear -- --profile mirelo auth login

# API-key profile; reads the key from stdin so it is not exposed in shell history.
op read 'op://Employee/Client A Linear/API Key' | bun run linear -- --profile client-a auth profile add-key

# Select a profile for one command, or via LINEAR_PROFILE in a script.
bun run linear -- --profile mirelo issue get STU-123
LINEAR_PROFILE=client-a bun run linear -- issue search --team ENG

# List or remove profiles. OAuth removal succeeds only after remote revocation succeeds.
bun run linear -- auth profile list
bun run linear -- --profile client-a auth profile rename client-acme
bun run linear -- --profile client-a auth profile remove
```

Profiles are stored separately under `~/.config/linear-cli/profiles/`; no profile is chosen automatically. A selected profile cannot be combined with `LINEAR_API_KEY`, `LINEAR_ACCESS_TOKEN`, or `LINEAR_CREDENTIALS_FILE`, which prevents a command from silently running against a different workspace. Profile listings, status output, and debug logging never print credentials.

Creating a profile never overwrites one with the same name. Use `--replace` explicitly when rotating a profile credential.

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
bun run linear-admin -- auth token --scope read,admin --print-env
```

Or fetch a token inline:

```bash
bun run linear-admin -- webhooks list --json
```

For shared/admin use, prefer OAuth with the smallest viable scopes. Do not request `admin` unless the command actually needs admin-level endpoints.

## Usage

For local development:

```bash
bun install
cp .env.example .env   # then set LINEAR_API_KEY or LINEAR_ACCESS_TOKEN

# issue workflow
bun run linear -- issue get STU-123
bun run linear -- issue update STU-123 --state Done
bun run linear -- issue update STU-123 --parent STU-993
bun run linear -- issue update STU-123 --parent none
bun run linear -- issue comment STU-123 --body-file ./comment.md
bun run linear -- issue create --team STU --project Transcriptor --title "Fix export flow"
bun run linear -- issue create --team STU --parent STU-993 --title "Fix child flow"

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
bun run build
bun run typecheck
bun run test
bun run schema:check   # validates GraphQL documents against Linear's published schema
bun run smoke:global-install
bun run verify         # lint + types + format + tests + schema + smoke
```

Set `LINEAR_ADMIN_AUDIT_LOG=./audit.jsonl` to record one redacted JSONL line per applied mutation.

## Releasing

Maintainers publish from annotated version tags. The tag must match `package.json` version.

```bash
# 1. Confirm the @zenthor-hub scope is owned and trusted publishing is configured
#    on npmjs.com for zenthor-hub/linear-cli -> publish.yml

# 2. Bump version in package.json, commit, and tag
git tag v0.1.0
git push origin v0.1.0
```

The [Publish workflow](.github/workflows/publish.yml) runs on `ubuntu-latest`, verifies the repo, and publishes with npm provenance. Configure one of:

- **Trusted publishing (recommended):** add `zenthor-hub/linear-cli` with workflow `publish.yml` on [npmjs.com](https://www.npmjs.com). No `NPM_TOKEN` secret is required; provenance is generated automatically.
- **Token fallback:** add an `NPM_TOKEN` repository secret with publish access to `@zenthor-hub/linear-cli`.

## Implementation Guide

See [docs/implementation.md](docs/implementation.md).
