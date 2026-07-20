# Linear CLI Command Guide

## Entrypoints

Agents: define the checkout invoker once (see `SKILL.md`), then use bare names below.

```bash
export LINEAR_CLI_ROOT="${LINEAR_CLI_ROOT:-$HOME/Developer/clis/linear-cli}"
linear() { (cd "$LINEAR_CLI_ROOT" && bun run linear -- "$@"); }
linear-admin() { (cd "$LINEAR_CLI_ROOT" && bun run linear-admin -- "$@"); }
```

- Prefer that invoker over unverified PATH binaries (PATH may resolve to a different clone).
- Do not use Linear MCP for ticket/admin work when this CLI is available.
- Add `--json` to any command whose output will be parsed by an agent.
- Add `--debug` only when diagnosing API behavior; diagnostics are redacted but still belong in stderr, not copied into public comments.
- Optional global flag: `--profile <name>` (or `LINEAR_PROFILE`) for named credential profiles.
- The `--` after `bun run linear` / `bun run linear-admin` is required so Bun forwards flags to the CLI.

Examples below use `linear …` / `linear-admin …` assuming the invoker (or a verified PATH binary for this tree) is already in place.

## Authentication

Prefer interactive OAuth for local use:

```bash
linear auth login
linear auth whoami --json
linear auth status --json
```

Env credentials (exactly one request credential):

```bash
LINEAR_API_KEY=lin_api_...
LINEAR_ACCESS_TOKEN=...
```

`LINEAR_API_KEY` is sent directly as the `Authorization` header. `LINEAR_ACCESS_TOKEN` is sent as `Bearer <token>`. The CLI rejects runs where both are set.

Named profiles:

```bash
linear --profile mirelo auth login
op read 'op://…/API Key' | linear --profile client-a auth profile add-key
linear auth profile list
linear --profile client-a auth profile rename client-acme
linear --profile client-a auth profile remove
```

Profiles live under `~/.config/linear-cli/profiles/`. A selected profile cannot be combined with `LINEAR_API_KEY`, `LINEAR_ACCESS_TOKEN`, or `LINEAR_CREDENTIALS_FILE`.

Check identity and workspace:

```bash
linear auth whoami --json
linear-admin auth whoami --json
```

## Issue Reading

Get an issue by human identifier or UUID:

```bash
linear issue get STU-123 --json
```

Search issues (structured filters and/or full-text):

```bash
linear issue search --team STU --limit 25 --json
linear issue search --team STU --state "In Progress" --json
linear issue search --team STU --assignee me --json
linear issue search --query "export flow" --team STU --json
linear issue search --team STU --assignee unassigned --include-archived --json
```

`--state` requires `--team` because state names are team scoped. `--limit` defaults to `50`. Use `--query` for Linear full-text search (`searchIssues`).

List comments and relations:

```bash
linear issue comments STU-123 --json
linear issue relation list STU-123 --json
```

## Discovery

List workflow states:

```bash
linear states list --team STU --json
```

List labels:

```bash
linear labels list --team STU --include-workspace --json
```

List projects and cycles:

```bash
linear project list --team STU --json
linear project get Transcriptor --json
linear cycle list --team STU --only active --json
```

List teams and users:

```bash
linear-admin teams list --json
linear-admin teams list --public --json
linear-admin users list --admin --json
linear-admin users list --inactive --json
```

Do not combine mutually exclusive filters such as `--private` with `--public`, or `--active` with `--inactive`.

## Issue Mutations

Issue mutations are dry-run by default. A dry-run resolves references and returns the planned GraphQL input without changing Linear.

Update an issue:

```bash
linear issue update STU-123 --state Done --json
linear issue update STU-123 --assignee me --priority high --json
linear issue update STU-123 --project Transcriptor --cycle active --due-date 2026-03-01 --estimate 3 --json
linear issue update STU-123 --add-label bug --remove-label wontfix --json
linear issue update STU-123 --label bug --label customer-impact --json
```

`--label` replaces the full label set. Prefer `--add-label` / `--remove-label` for incremental changes. Do not combine replace and add/remove in one command.

Create an issue:

```bash
linear issue create --team STU --title "Fix import regression" --description-file ./issue.md --json
linear issue create --team STU --project Transcriptor --cycle active --title "Ship export" --json
```

Comment on an issue:

```bash
linear issue comment STU-123 --body-file ./comment.md --json
```

Archive / relations:

```bash
linear issue archive STU-123 --json
linear issue unarchive STU-123 --json
linear issue relation create STU-123 --type blocks --related STU-124 --json
linear issue relation delete RELATION_ID --json
```

Relation types: `blocks`, `duplicate`, `related`, `similar`.

Apply only after explicit user approval:

```bash
linear issue update STU-123 --state Done --apply --json
linear issue create --team STU --title "Fix import regression" --description-file ./issue.md --apply --json
linear issue comment STU-123 --body-file ./comment.md --apply --json
linear issue archive STU-123 --apply --json
```

Supported priority values are `none`, `urgent`, `high`, `normal`, `low`, or numeric `0` through `4`.

Use `none`, `null`, or `unassigned` to clear an assignee. Use `none` to clear parent, project, cycle, due date, or estimate where those flags accept clear values.

## Admin Operations

List webhooks:

```bash
linear-admin webhooks list --json
```

Create a webhook dry-run:

```bash
linear-admin webhooks create --url https://example.com/webhooks/linear --team TEAM_ID --resource Issue --json
```

Update / rotate / delete webhook dry-runs:

```bash
linear-admin webhooks update WEBHOOK_ID --label production --enabled --json
linear-admin webhooks rotate-secret WEBHOOK_ID --json
linear-admin webhooks delete WEBHOOK_ID --json
```

Webhook creation requires HTTPS, rejects localhost URLs, requires at least one `--resource`, and requires exactly one scope: `--team` or `--all-public-teams`. Rotated secrets are sensitive; treat applied rotate-secret output carefully.

Apply admin mutations only after explicit user approval:

```bash
linear-admin webhooks create --url https://example.com/webhooks/linear --team TEAM_ID --resource Issue --apply --json
linear-admin webhooks update WEBHOOK_ID --disabled --apply --json
linear-admin webhooks rotate-secret WEBHOOK_ID --apply --json
linear-admin webhooks delete WEBHOOK_ID --apply --json
```

## Raw GraphQL

Use raw GraphQL only when no structured command fits.

```bash
linear-admin gql ./query.graphql --vars ./vars.json --json
```

Rules:

- Store the document in a `.graphql` file.
- Store variables in a JSON file and pass `--vars`.
- The CLI parses the GraphQL document AST to detect mutation operations.
- Mutation documents are dry-run by default and execute only with `--apply`.
- Prefer query documents for inspection and structured CLI commands for common issue mutations.

## Output And Errors

JSON output uses envelopes with the operation name and either result data or error details. Successful dry-runs exit `0`; configuration and usage errors exit `2`; other failures exit `1`.

GraphQL errors are treated as failures even if the HTTP status is `200`.

Applied mutations are auditable. Set `LINEAR_ADMIN_AUDIT_LOG=./audit.jsonl` to record redacted JSONL audit lines for applied mutations.

## Repository Verification

Before changing this CLI or skill, run focused checks when possible:

```bash
bun test
bun run typecheck
```

Run the full gate before committing:

```bash
bun run verify
```
