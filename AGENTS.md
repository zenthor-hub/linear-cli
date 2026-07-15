# Agent Usage

Use `linear` for normal ticket work:

```bash
bun run linear -- issue get STU-123 --json
bun run linear -- issue search --team STU --state "In Progress" --limit 25 --json
bun run linear -- issue search --query "export flow" --team STU --json
bun run linear -- issue update STU-123 --state Done --json
bun run linear -- issue update STU-123 --add-label bug --project Transcriptor --json
bun run linear -- issue comments STU-123 --json
bun run linear -- issue archive STU-123 --json
bun run linear -- issue relation list STU-123 --json
bun run linear -- issue comment STU-123 --body-file ./comment.md --json
bun run linear -- project list --team STU --json
bun run linear -- cycle list --team STU --json
```

Use `linear-admin` only for workspace/admin operations:

```bash
bun run linear-admin -- teams list --json
bun run linear-admin -- users list --admin --json
bun run linear-admin -- webhooks list --json
bun run linear-admin -- webhooks update WEBHOOK_ID --label prod --json
bun run linear-admin -- gql ./query.graphql --json
```

Rules:

- Prefer `linear` for issue creation, updates, comments, archive, relations, projects, cycles, state discovery, and label discovery.
- Prefer `linear-admin` for users, teams, webhooks, and raw GraphQL.
- Prefer `--query` for full-text issue search; use structured `--team/--state/--assignee` filters when known. Always pass `--limit` for large workspaces (default 50).
- Prefer `--add-label` / `--remove-label` over `--label` (replace-all) unless a full label set is intended.
- For local auth, prefer `linear auth login` (or `linear-admin auth login` for admin scope) over API keys.
- Check `linear auth status --json` when credential errors occur.
- Always use `--json` when parsing output programmatically.
- Never pass `--apply` unless the user explicitly asks to mutate Linear.
- Use `--body-file` and `--description-file` for long Markdown.
- Prefer human identifiers such as `STU-123` and team keys such as `STU`; the CLI resolves IDs.
- Raw GraphQL is an escape hatch, not the default ticket workflow.
