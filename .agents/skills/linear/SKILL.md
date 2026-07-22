---
name: linear
description: Safely manage Linear tickets and workspace/admin data with the zenthor-hub/linear-cli checkout (not Linear MCP, not an unverified PATH binary). Use when the user asks an agent to read, search, create, update, comment on, archive, relate, or audit Linear issues, projects, cycles, states, labels, inbox notifications, teams, users, webhooks, or raw Linear GraphQL.
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

A selected profile cannot be combined with `LINEAR_API_KEY`, `LINEAR_ACCESS_TOKEN`, or `LINEAR_CREDENTIALS_FILE`.

## Safety Rules

- Prefer this CLI over Linear MCP for all issue and admin workflows.
- Prefer `linear` for issue creation, updates, comments, archive, relations, projects, cycles, inbox notifications, state discovery, and label discovery.
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
3. Read before writing. Use `issue get`, `issue search`, `states list`, `labels list`, `project list`, `cycle list`, and `notification list` to resolve identifiers and available values.
4. Prepare long descriptions or comments in a temporary Markdown file and pass them with `--description-file` or `--body-file`.
5. For create, update, comment, archive, relation, notification, webhook, or GraphQL mutation work, run without `--apply` first and capture the dry-run JSON.
6. Apply only when the user has clearly approved the exact mutation. Include `--json` on the applied command and summarize the returned identifier or URL.

## Global install (humans only)

For interactive shell use, humans may install or link binaries so PATH points at this package (not a fork):

```bash
bun install -g @zenthor-hub/linear-cli
```

Agents should keep using the checkout invoker unless PATH is verified to target this tree.

## Command Reference

Read `references/command-guide.md` when you need exact command options, mutation patterns, raw GraphQL rules, authentication behavior, exit codes, or verification guidance.
