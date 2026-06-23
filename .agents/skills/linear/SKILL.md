---
name: linear
description: Safely manage Linear tickets and workspace/admin data through the local Mirelo linear-cli repository. Use when the user asks an agent to read, search, create, update, comment on, or audit Linear issues, states, labels, teams, users, webhooks, or raw Linear GraphQL using `bun run linear` and `bun run linear-admin`.
---

# Linear CLI

Use the local Linear CLI in this repository as the first choice for Linear work:

```bash
bun run linear -- issue get STU-123 --json
bun run linear -- issue search --team STU --state "In Progress" --json
bun run linear -- issue update STU-123 --state Done --json
bun run linear -- issue comment STU-123 --body-file ./comment.md --json
```

Use `linear-admin` only for workspace or admin operations:

```bash
bun run linear-admin -- teams list --json
bun run linear-admin -- users list --admin --json
bun run linear-admin -- webhooks list --json
bun run linear-admin -- gql ./query.graphql --json
```

## Safety Rules

- Prefer `linear` for issue creation, updates, comments, state discovery, and label discovery.
- Prefer `linear-admin` for users, teams, webhooks, and raw GraphQL.
- Always add `--json` when parsing command output programmatically.
- Never pass `--apply` unless the user explicitly asks to mutate Linear.
- For mutations, run the dry-run form first, inspect the planned input, then rerun with `--apply` only after explicit approval.
- Use `--body-file` and `--description-file` for long Markdown. Do not inline large comments or descriptions in shell commands.
- Prefer human identifiers such as `STU-123` and team keys such as `STU`; the CLI resolves IDs.
- Treat raw GraphQL as an escape hatch, not the default ticket workflow.
- Keep secrets out of command arguments and files committed to the repo. Use `LINEAR_API_KEY` or `LINEAR_ACCESS_TOKEN` from the environment.

## Workflow

1. Verify context with `bun run linear -- auth whoami --json` when credentials, workspace, or token scope are uncertain.
2. Read before writing. Use `issue get`, `issue search`, `states list`, and `labels list` to resolve identifiers and available values.
3. Prepare long descriptions or comments in a temporary Markdown file and pass it with `--description-file` or `--body-file`.
4. For create, update, comment, webhook create, webhook delete, or GraphQL mutation work, run the command without `--apply` first and capture the dry-run JSON.
5. Apply only when the user has clearly approved the exact mutation. Include `--json` on the applied command and summarize the returned identifier or URL.

## Command Reference

Read `references/command-guide.md` when you need exact command options, mutation patterns, raw GraphQL rules, authentication behavior, exit codes, or verification guidance.
