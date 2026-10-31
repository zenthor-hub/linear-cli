---
name: linear
description: Safely manage Linear tickets and workspace/admin data with the zenthor-hub/linear-cli checkout (not Linear MCP, not an unverified PATH binary). Use when the user asks an agent to read, search, create, update, comment on, archive, relate, or audit Linear issues, Linear Docs/documents (linear.app/<org>/document/... URLs, rules ledgers, specs), projects, cycles, states, labels, inbox notifications, teams, users, webhooks, or raw Linear GraphQL.
---

# Linear CLI

## How to invoke

Canonical package: `@zenthor-hub/linear-cli` (`zenthor-hub/linear-cli`).

**Do not use Linear MCP** for ticket or admin work when this CLI is available.

**Do not trust bare `linear` / `linear-admin` on PATH** unless you have verified they resolve to this checkout. PATH may point at another clone.

Define the invoker once per shell session, then use bare command names everywhere below:

```bash
export LINEAR_CLI_ROOT="${LINEAR_CLI_ROOT:-$HOME/Developer/clis/linear-cli}"

linear() {
  (cd "$LINEAR_CLI_ROOT" && bun run linear -- "$@")
}

linear-admin() {
  (cd "$LINEAR_CLI_ROOT" && bun run linear-admin -- "$@")
}
```

The `--` after `bun run linear` / `bun run linear-admin` is required so Bun forwards flags to the CLI. Override `LINEAR_CLI_ROOT` when the checkout lives elsewhere.

Verify identity when credentials, workspace, or token scope are uncertain:

```bash
linear auth whoami --json
```

## Issue workflow

```bash
linear auth whoami --json
linear issue get STU-123 --json
linear issue search --team STU --state "In Progress" --limit 25 --json
linear issue search --query "export flow" --team STU --json
linear issue update STU-123 --state Done --json
linear issue update STU-123 --add-label bug --project Transcriptor --json
linear issue comments STU-123 --json
linear issue archive STU-123 --json
linear issue relation list STU-123 --json
linear issue comment STU-123 --body-file ./comment.md --json
linear project list --team STU --json
linear cycle list --team STU --json
linear notification list --unread --limit 25 --json
linear notification list --category reviews --since 2026-07-01T00:00:00.000Z --json
linear notification unread-count --json
linear notification update NOTIFICATION_ID --read --json
linear notification mark-read --issue STU-123 --json
linear notification subscription list --json
linear notification category-channel get --json
```

## Docs workflow

`<ref>` is a linear.app document URL (`https://linear.app/<org>/document/<title>-<slugId>`), the trailing slugId, or a UUID. Use this instead of opening linear.app document URLs in a browser (they hand off to the desktop app) or raw GraphQL.

```bash
# read (no --apply needed)
linear --profile catapult doc get https://linear.app/catapult-lighting/document/catapult-rules-ledger-agents-1d4ba304cb49 --json
linear doc get 1d4ba304cb49 --section "EST-006" --json      # just one markdown section
linear doc list --team STU --limit 20 --json                 # metadata + url, no content
linear doc list --project Transcriptor --json
linear doc search "rules ledger" --limit 10 --json           # metadata + short excerpt
linear doc comments 1d4ba304cb49 --json

# write: every command below is a DRY RUN until you add --apply
linear doc create --title "Spec" --team STU --content-file ./spec.md --json
linear doc update 1d4ba304cb49 --section "EST-006" --content-file ./est-006.md --json   # prints diff + readUpdatedAt
linear doc update 1d4ba304cb49 --append-file ./new-rule.md --json
linear doc update 1d4ba304cb49 --title "New title" --icon Database --color "#0ea5e9" --json
linear doc archive 1d4ba304cb49 --json        # moves to trash (restorable); no hard delete exists
linear doc restore 1d4ba304cb49 --json
linear doc comment 1d4ba304cb49 --body-file ./comment.md --json
linear doc comment 1d4ba304cb49 --body "Agreed." --reply-to COMMENT_ID --json

# apply a reviewed content edit, pinned to the version the diff was made against
linear doc update 1d4ba304cb49 --section "EST-006" --content-file ./est-006.md \
  --expect-updated-at <readUpdatedAt from the dry run> --apply --json
```

- Writes need `--apply`, and only after the user approves the exact dry-run payload/diff. Some docs (e.g. signed product-rule ledgers) must never be edited without that approval.
- Content edits (`--content`, `--content-file`, `--section`, `--append-file`) with `--apply` require `--expect-updated-at`. A `ConflictError` means someone edited the doc since your read: nothing was written; re-read, redo the edit, and dry-run again. Never "fix" it by copying the new timestamp without re-reading.
- A `--section` replacement file must start with the section's heading line; the replaced range is the heading through the next heading of the same or higher level. Read the section first with `doc get --section` and edit that text.
- `--section` errors on zero or multiple matches and lists candidates; add more heading text to disambiguate.
- Use `--content-file`/`--body-file` (or `-` for stdin) for multi-line markdown; `--content "a\nb"` sends a literal backslash-n.

## Admin workflow

```bash
linear-admin teams list --json
linear-admin users list --admin --json
linear-admin webhooks list --json
linear-admin webhooks update WEBHOOK_ID --label prod --json
linear-admin gql ./query.graphql --json
```

## Profiles (multi-workspace)

```bash
linear --profile mirelo auth login
linear --profile mirelo issue get STU-123 --json
LINEAR_PROFILE=client-a linear issue search --team ENG --json
linear auth profile list
```

A selected profile takes precedence over `LINEAR_API_KEY`, `LINEAR_ACCESS_TOKEN`, and `LINEAR_CREDENTIALS_FILE`, which are ignored while it is selected.

## Safety Rules

- Prefer this CLI over Linear MCP for all issue and admin workflows.
- Prefer `linear` for issue creation, updates, comments, archive, relations, projects, cycles, Linear Docs (`linear doc`), inbox notifications, state discovery, and label discovery.
- Prefer `linear-admin` for users, teams, webhooks, and raw GraphQL.
- Prefer `--query` for full-text search; always bound list results with `--limit` (default 50).
- Prefer `--add-label` / `--remove-label` over replace-all `--label` unless intentional.
- Always add `--json` when parsing command output programmatically.
- Never pass `--apply` unless the user explicitly asks to mutate Linear.
- For mutations, run the dry-run form first, inspect the planned input, then rerun with `--apply` only after explicit approval.
- Use `--body-file` and `--description-file` for long Markdown. Do not inline large comments or descriptions in shell commands.
- Prefer human identifiers such as `STU-123` and team keys such as `STU`; the CLI resolves IDs.
- Treat raw GraphQL as an escape hatch, not the default ticket workflow.
- Keep secrets out of command arguments and files committed to the repo. Prefer `linear auth login` or named profiles; env `LINEAR_API_KEY` / `LINEAR_ACCESS_TOKEN` for CI.

## Workflow

1. Define the invoker (`LINEAR_CLI_ROOT` + `linear` / `linear-admin` functions above). Do not rely on an unverified PATH binary.
2. Verify context with `auth whoami --json` (or `--profile <name> auth whoami --json`) when credentials, workspace, or token scope are uncertain.
3. Read before writing. Use `issue get`, `issue search`, `doc get`, `doc search`, `states list`, `labels list`, `project list`, `cycle list`, and `notification list` to resolve identifiers and available values.
4. Prepare long descriptions or comments in a temporary Markdown file and pass them with `--description-file` or `--body-file`.
5. For create, update, comment, archive, relation, document, notification, webhook, or GraphQL mutation work, run without `--apply` first and capture the dry-run JSON.
6. Apply only when the user has clearly approved the exact mutation. Include `--json` on the applied command and summarize the returned identifier or URL.

## Global install (humans only)

For interactive shell use, humans may install or link binaries so PATH points at this package (not a fork):

```bash
bun install -g @zenthor-hub/linear-cli
```

Agents should keep using the checkout invoker unless PATH is verified to target this tree.

## Command Reference

Read `references/command-guide.md` when you need exact command options, mutation patterns, raw GraphQL rules, authentication behavior, exit codes, or verification guidance.
