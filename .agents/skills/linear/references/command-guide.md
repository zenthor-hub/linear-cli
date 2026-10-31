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

Profiles live under `~/.config/linear-cli/profiles/`. A selected profile takes precedence over `LINEAR_API_KEY`, `LINEAR_ACCESS_TOKEN`, and `LINEAR_CREDENTIALS_FILE`, which are ignored while it is selected.

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

## Notifications (Inbox)

List and inspect inbox notifications:

```bash
linear notification list --limit 25 --json
linear notification list --unread --limit 25 --json
linear notification list --category reviews --type pullRequestCommented --since 2026-07-01T00:00:00.000Z --json
linear notification get NOTIFICATION_ID --json
linear notification unread-count --json
```

`--limit` defaults to `50`. `--unread` and `--category` filter client-side (Linear’s `NotificationFilter` does not expose `readAt` or `category`); listing pages until the requested `--limit` is filled or the inbox ends. A 100-page scan cap (~5,000 rows) throws if it is hit before the limit is filled — narrow with `--since` / `--before` / `--type` / `--subscription-type` rather than relying on silent truncation. `--type`, `--subscription-type`, `--since`, and `--before` use server filters (`--subscription-type` is validated locally; `--since` must be ≤ `--before`).

Triage mutations are dry-run by default:

```bash
linear notification update NOTIFICATION_ID --read --json
linear notification update NOTIFICATION_ID --read-at 2026-07-22T12:00:00.000Z --json
linear notification mark-read --issue STU-123 --json
linear notification mark-unread --project Transcriptor --json
linear notification snooze --issue STU-123 --until 2026-07-23T12:00:00.000Z --json
linear notification unsnooze --issue STU-123 --json
linear notification archive NOTIFICATION_ID --json
linear notification archive-all --issue STU-123 --json
linear notification unarchive NOTIFICATION_ID --json
```

Entity selectors for batch ops: exactly one of `--id`, `--issue`, `--project`, `--initiative`, `--project-update`, `--initiative-update`, or `--oauth-client-approval`. Pull request inbox rows have no entity selector in Linear’s API — use `--id`.

Subscriptions and channel preferences:

```bash
linear notification subscription list --json
linear notification subscription get SUBSCRIPTION_ID --json
linear notification subscription create --team STU --type issue --json
linear notification subscription update SUBSCRIPTION_ID --inactive --json
linear notification subscription delete SUBSCRIPTION_ID --json
linear notification category-channel get --json
linear notification category-channel set --channel desktop --category mentions --subscribe --json
```

Apply only after explicit approval:

```bash
linear notification update NOTIFICATION_ID --read --apply --json
linear notification mark-read --issue STU-123 --apply --json
linear notification archive NOTIFICATION_ID --apply --json
linear notification subscription create --team STU --type issue --apply --json
linear notification subscription delete SUBSCRIPTION_ID --apply --json
linear notification category-channel set --channel email --category reviews --unsubscribe --apply --json
```

## Linear Docs

`<ref>` accepts `https://linear.app/<org>/document/<title-slug>-<slugId>`, the bare slugId, or a document UUID. A ref that does not resolve is a `ConfigError` (exit `2`), never an empty success; for a URL the message names the URL's workspace so a wrong `--profile` is obvious.

Read:

```bash
linear doc get REF --json                      # metadata (id, slugId, title, url, icon, color, project, team, creator, updatedBy, createdAt, updatedAt) + content
linear doc get REF --section "EST-006" --json   # metadata + section {heading, level, line, content}; no full content
linear doc list [--project P | --team T] [--include-archived] [--limit 20] --json
linear doc search TEXT [--project P | --team T] [--include-archived] [--limit 20] --json
linear doc comments REF [--limit 50] --json     # author, createdAt, body, resolvedAt/resolvingUser, parent (thread)
```

`--section` matching is case-insensitive; an exact heading text wins, else the text must appear as a whole token. Zero or multiple matches is an error listing candidates. Headings in fenced code are ignored.

`doc search` uses `searchDocuments`: `--team` is server-side; `--project` is a client-side filter over at most 4 pages of 50 results. Excerpts are computed locally; content is not returned.

Write (dry-run by default; `--apply` executes):

```bash
linear doc create --title T [--project P | --team T] [--content MD | --content-file PATH|-] [--icon I] [--color HEX] --json
linear doc update REF [--title T] [--project P] [--icon I] [--color HEX] --json
linear doc update REF --content-file PATH|- --json                     # replace the whole body
linear doc update REF --section HEADING --content-file PATH --json     # replace one section (file must start with its heading)
linear doc update REF --append-file PATH|- --json                      # append to the end
linear doc archive REF --json                                          # documentDelete -> trash (restorable)
linear doc restore REF --json                                          # documentUnarchive
linear doc comment REF (--body MD | --body-file PATH|-) [--reply-to COMMENT_ID] --json
```

Dry-run JSON for `doc update` contains `input` (exact `documentUpdate` input), `plannedChanges`, `readUpdatedAt`, and for content edits `contentChange.diff` (unified diff). Apply a content edit with:

```bash
linear doc update REF --section HEADING --content-file PATH --expect-updated-at READ_UPDATED_AT --apply --json
```

Content edits refuse `--apply` without `--expect-updated-at`. A mismatch raises `ConflictError` (exit `1`, `error.details.expectedUpdatedAt/actualUpdatedAt`) and writes nothing. The CLI also re-reads right before the mutation and refuses if the doc changed. `--reply-to` must be a thread-root comment on the same document. There is no permanent delete.

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

JSON output uses envelopes with the operation name and either result data or error details. Successful dry-runs exit `0`; configuration and usage errors exit `2`; other failures exit `1`. A refused stale document write is `ConflictError` (exit `1`).

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
