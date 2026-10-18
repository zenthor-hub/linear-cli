# Contributing

Thanks for your interest in improving `@zenthor-hub/linear-cli`.

## Getting Started

Requirements:

- Node.js 22.12 or newer
- Bun 1.3.14

```bash
git clone https://github.com/zenthor-hub/linear-cli.git
cd linear-cli
bun install
cp .env.example .env
```

For local development, use the repo entrypoints:

```bash
bun run linear -- auth status --json
bun run linear-admin -- teams list --json
```

## Development Workflow

1. Create a branch from `main`.
2. Make focused changes with tests when behavior changes.
3. Run verification before opening a pull request:

```bash
bun run verify
```

`bun run verify` is the canonical check. It runs linting, typechecking, formatting, unit tests, and a global-install smoke test.

## Pull Requests

- Keep changes small and explain the motivation in the PR description.
- Include command examples or JSON output when CLI behavior changes.
- Do not commit secrets, `.env` files, or local credential paths.
- Do not run Linear mutations with `--apply` in CI or example scripts unless the change explicitly requires it.

## Command Design Guidelines

- Prefer `linear` for issue workflows and `linear-admin` for workspace/admin operations.
- Default destructive or bulk operations to dry-run; require `--apply` for mutations.
- Support `--json` for machine-readable output.
- Use human identifiers such as `STU-123` where possible; resolve IDs internally.
- Keep raw GraphQL available under `linear-admin gql` as an escape hatch.

## Releases

Maintainers publish releases from version tags (`v*`) using the GitHub Actions publish workflow. See `.github/workflows/publish.yml` and the release checklist in the repository README.

If you are preparing a release:

1. Confirm the `@zenthor-hub` npm scope is configured for trusted publishing.
2. Bump `package.json` version and update the changelog if one exists.
3. Tag the release as `vX.Y.Z` and push the tag.

## Questions

Open a GitHub issue for bugs, feature requests, or design questions:

https://github.com/zenthor-hub/linear-cli/issues
