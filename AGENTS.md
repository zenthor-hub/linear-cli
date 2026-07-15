# Agent Usage

Prefer the **globally installed** `linear` / `linear-admin` binaries (on PATH). Inside this repo on unreleased code you may use `bun run linear -- …` / `bun run linear-admin -- …` instead.

Use `linear` for normal ticket work:

```bash
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

Use `linear-admin` only for workspace/admin operations:

```bash
linear-admin teams list --json
linear-admin users list --admin --json
linear-admin webhooks list --json
linear-admin webhooks update WEBHOOK_ID --label prod --json
linear-admin gql ./query.graphql --json
```

Rules:

- Prefer `linear` for issue creation, updates, comments, archive, relations, projects, cycles, state discovery, and label discovery.
- Prefer `linear-admin` for users, teams, webhooks, and raw GraphQL.
- Prefer `--query` for full-text issue search; use structured `--team/--state/--assignee` filters when known. Always pass `--limit` for large workspaces (default 50).
- Prefer `--add-label` / `--remove-label` over `--label` (replace-all) unless a full label set is intended.
- For local auth, prefer `linear auth login` (or `linear-admin auth login` for admin scope) over API keys.
- Multi-workspace: `linear --profile <name> …` or `LINEAR_PROFILE=<name>`.
- Check `linear auth status --json` when credential errors occur.
- Always use `--json` when parsing output programmatically.
- Never pass `--apply` unless the user explicitly asks to mutate Linear.
- Use `--body-file` and `--description-file` for long Markdown.
- Prefer human identifiers such as `STU-123` and team keys such as `STU`; the CLI resolves IDs.
- Raw GraphQL is an escape hatch, not the default ticket workflow.
