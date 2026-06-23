# Agent Usage

Use `linear` for normal ticket work:

```bash
bun run linear -- issue get STU-123 --json
bun run linear -- issue search --team STU --state "In Progress" --json
bun run linear -- issue update STU-123 --state Done --json
bun run linear -- issue comment STU-123 --body-file ./comment.md --json
```

Use `linear-admin` only for workspace/admin operations:

```bash
bun run linear-admin -- teams list --json
bun run linear-admin -- users list --admin --json
bun run linear-admin -- webhooks list --json
bun run linear-admin -- gql ./query.graphql --json
```

Rules:

- Prefer `linear` for issue creation, updates, comments, state discovery, and label discovery.
- Prefer `linear-admin` for users, teams, webhooks, and raw GraphQL.
- Always use `--json` when parsing output programmatically.
- Never pass `--apply` unless the user explicitly asks to mutate Linear.
- Use `--body-file` and `--description-file` for long Markdown.
- Prefer human identifiers such as `STU-123` and team keys such as `STU`; the CLI resolves IDs.
- Raw GraphQL is an escape hatch, not the default ticket workflow.
