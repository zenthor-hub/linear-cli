# Agent Usage

Use the Linear skill at `.agents/skills/linear/SKILL.md` (symlinked into `~/.agents/skills/linear` and `~/.grok/skills/linear`).

**Do not use Linear MCP** for ticket or admin work when this CLI is available.

**Do not assume bare `linear` / `linear-admin` on PATH** — PATH may resolve to a different clone. Invoke via the canonical checkout as documented in the skill (`LINEAR_CLI_ROOT`, default `$HOME/Developer/clis/linear-cli`).

Never pass `--apply` unless the user explicitly asks to mutate Linear. Always use `--json` when parsing output.
