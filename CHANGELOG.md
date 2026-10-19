# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.3] - 2026-10-19

### Added

- Inbox notification commands: list, unread count, get, mark read, archive, subscriptions, and category-channel preferences.
- Notification list filters, paging that fills the requested limit, subscription delete, and a `--read` shortcut.
- Label create, with parent lookup scoped so a workspace label is not parented to a team label.
- Issue search, richer create and update fields, additive labels, archive and unarchive, comments, and issue relations.
- Project and cycle discovery, project updates and status posts, project filtering, and archive-aware project resolution.
- Webhook update and signing-secret rotation. Mutations stay dry-run until `--apply`.
- Named credential profiles, including rename.
- Raw GraphQL from stdin, dry-run mutation plans, and local schema checks.

### Changed

- An incomplete notification scan fails with an error.
- Client-side filters count only matching nodes toward the limit, and error when the page cap is hit before the limit is filled.
- Team and user resolution is shared across issue, project, cycle, and notification commands.
- Development, verification, and publish install dependencies with Bun.
- `bun run verify` checks GraphQL documents against Linear's published schema.
- Agent docs tell agents to invoke the canonical checkout via `LINEAR_CLI_ROOT`.

### Fixed

- An explicit `--profile` overrides `LINEAR_API_KEY` and other environment credentials, so a stray key no longer fails the command or selects another workspace.
- Notification lists default to 50 items, cap client-filter scans, reject invalid subscription types and time ranges, and truncate long comment previews.

### Security

- Logout keeps stored OAuth credentials when token revocation fails, and credential refreshes are serialized on the credential file.
- GraphQL mutations are not retried, and debug logs redact variable values.
- Agent skills follow an evidence trust policy and reject untrusted instruction fixtures.
- Dev dependencies: vitest `^4.1.12` and oxfmt `^0.67.0`, with a lockfile refresh that clears transitive security advisories.

## [0.1.2] - 2026-07-04

### Security

- Redact sensitive webhook and audit output.

## [0.1.1] - 2026-07-04

### Changed

- Describe the package as an unofficial community CLI, not affiliated with Linear.

### Fixed

- Publish `bin` paths without a `./` prefix so npm leaves `package.json` unchanged.
- Keep npm provenance on the GitHub Actions publish workflow, and turn it off for local `publishConfig`.
- Publish on Node 22 with an npm release that supports OIDC trusted publishing.

## [0.1.0] - 2026-07-04

### Added

- Initial release: issue workflows (including project assignment and parent issues), OAuth login, admin commands, and a raw GraphQL escape hatch.
- Agent skills, trust and contribution docs, and an npm publish workflow with provenance.

[0.1.3]: https://github.com/zenthor-hub/linear-cli/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/zenthor-hub/linear-cli/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/zenthor-hub/linear-cli/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/zenthor-hub/linear-cli/releases/tag/v0.1.0
