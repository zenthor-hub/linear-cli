---
name: linear
description: Safely manage Linear tickets and workspace/admin data with the globally installed linear / linear-admin CLI. Use when the user asks an agent to read, search, create, update, comment on, archive, relate, or audit Linear issues, projects, cycles, states, labels, teams, users, webhooks, or raw Linear GraphQL.
---

# Linear CLI

Use the **`linear`** and **`linear-admin`** binaries on PATH (install: `bun install -g @zenthor-hub/linear-cli`, or link from `~/Developer/clis/linear-cli`). Do not require a local checkout unless developing the CLI itself.

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

- Prefer `linear` for issue creation, updates, comments, archive, relations, projects, cycles, state discovery, and label discovery.
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

1. Verify context with `linear auth whoami --json` (or `linear --profile <name> auth whoami --json`) when credentials, workspace, or token scope are uncertain.
2. Read before writing. Use `issue get`, `issue search`, `states list`, `labels list`, `project list`, and `cycle list` to resolve identifiers and available values.
3. Prepare long descriptions or comments in a temporary Markdown file and pass it with `--description-file` or `--body-file`.
4. For create, update, comment, archive, relation, webhook, or GraphQL mutation work, run without `--apply` first and capture the dry-run JSON.
5. Apply only when the user has clearly approved the exact mutation. Include `--json` on the applied command and summarize the returned identifier or URL.

## Local CLI development only

When working inside the linear-cli source tree on unreleased code:

```bash
bun run linear -- …
bun run linear-admin -- …
```

## Command Reference

Read `references/command-guide.md` when you need exact command options, mutation patterns, raw GraphQL rules, authentication behavior, exit codes, or verification guidance.
