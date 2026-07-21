# Agent Usage

Use the Linear skill at `.agents/skills/linear/SKILL.md` (symlinked into `~/.agents/skills/linear` and `~/.grok/skills/linear`).

**Do not use Linear MCP** for ticket or admin work when this CLI is available.

**Do not assume bare `linear` / `linear-admin` on PATH** — PATH may resolve to a different clone. Invoke via the canonical checkout as documented in the skill (`LINEAR_CLI_ROOT`, default `$HOME/Developer/clis/linear-cli`).

Never pass `--apply` unless the user explicitly asks to mutate Linear. Always use `--json` when parsing output.

## Cursor Cloud specific instructions

This repo is a Bun-based CLI (`bun@1.3.14`, Node 22+); there is no server or UI to run. `bun` is preinstalled on the VM (symlinked at `/usr/local/bin/bun`) and dependencies are refreshed by the startup update script (`bun install --frozen-lockfile`).

- Canonical checks: `bun run verify` (oxlint + `tsc` typecheck + oxfmt + vitest + GraphQL schema check + global-install smoke). Individual scripts are in `package.json`. `bun run verify` runs fully offline — `schema:check` and `smoke:global-install` do not need Linear credentials.
- Run the CLIs in dev via `bun run linear -- <args>` and `bun run linear-admin -- <args>` (tsx), or build with `bun run build` then `node dist/linear.js` / `node dist/admin.js`.
- Live Linear API commands (`issue get`, `teams list`, dry-run mutations, etc.) require a credential: `LINEAR_API_KEY`, `LINEAR_ACCESS_TOKEN`, or `linear auth login`. With no credential, commands return a structured `ConfigError` envelope and exit non-zero — this is expected, not an environment failure. Offline commands like `linear auth status --json` and `--help` work without a token.
- Mutations default to dry-run; `--apply` is required to execute. Do not use `--apply` in setup/testing.
