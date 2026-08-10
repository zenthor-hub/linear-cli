# Plan 001: Establish the project field and validation contract

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 07b7043 -- src/commands/projects.ts src/linear.ts src/graphql/documents.ts test/project-workflows.test.ts README.md docs/implementation.md`
> The working tree intentionally contains the project-workflow implementation
> being reviewed. Compare the current excerpts below against the live code
> before editing; do not discard or reset any existing changes.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: docs / dx
- **Planned at**: commit `07b7043`, 2026-08-10

## Why this matters

The CLI now exposes both `linear project update --description*` and
`linear project post-update --body*`, but the public documentation does not
explicitly state the boundary between the project’s short description and a
project-update body. The implementation also presents the 255-character rule
as a product/API fact without recording whether it is an API limit or an
intentional CLI policy. Make the mapping and validation policy explicit so
agents do not use the description flag as a long markdown-body substitute.

This plan keeps the original requested behavior: descriptions remain limited
to 255 Unicode code points as currently counted by `Array.from`, update bodies remain
non-empty, and health remains an exact enum. It does not add a new
`--content` feature.

## Current state

- `src/commands/projects.ts:76-122` reads inline/file text, validates strict
  project dates, rejects descriptions whose `Array.from(description).length`
  exceeds 255, and accepts only `onTrack`, `atRisk`, and `offTrack` health.
- `src/commands/projects.ts:289-372` maps `--description*` to the project
  mutation input and maps `--body*` plus health to project-update creation.
- `src/graphql/documents.ts:236-247` models `Project.description` separately
  from `ProjectUpdate.body`; the project read fragment at lines 696-714
  selects `description` and recent updates.
- `src/linear.ts:492-561` currently describes `--description` as the project
  description and `--body` as the project-update body, but does not explicitly
  explain that these are different fields.
- `README.md:138-149` and `docs/implementation.md:126-137` document the
  safety and validation rules, but not the description/body distinction or
  whether 255 is server-enforced.
- `src/output/format.ts:3-35` already provides a stable `{ok, operation, data}`
  JSON success envelope and typed error envelope. Do not redesign that global
  contract in this plan.

## Commands you will need

| Purpose                    | Command                                                                                                                                                      | Expected on success                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Drift check                | `git diff --stat 07b7043 -- src/commands/projects.ts src/linear.ts src/graphql/documents.ts test/project-workflows.test.ts README.md docs/implementation.md` | Shows committed and uncommitted changes since the planned baseline; no reset or checkout is performed |
| Schema/document validation | `bun run schema:check`                                                                                                                                       | Exit 0; all hand-written GraphQL documents validate                                                   |
| Focused tests              | `bun run test -- test/project-workflows.test.ts`                                                                                                             | All project workflow tests pass                                                                       |
| Typecheck                  | `bun run typecheck`                                                                                                                                          | Exit 0 with no TypeScript errors                                                                      |
| Full verification          | `bun run verify`                                                                                                                                             | Exit 0                                                                                                |

## Scope

**In scope** (the only source/docs/tests to modify):

- `src/linear.ts` — clarify help text for `--description*` and `--body*`.
- `src/commands/projects.ts` — retain or clarify validation comments/messages
  only if needed to match the documented contract.
- `README.md` — document the short-description/project-update-body boundary
  and label the 255-character rule as either an authoritative API limit or a
  deliberate CLI validation policy.
- `docs/implementation.md` — mirror the same contract in the implementation
  notes.
- `test/project-workflows.test.ts` — add or adjust mocked tests for the
  accepted boundary and the documented rejection cases.

**Out of scope** (do not touch):

- Adding `--content`, changing project-update GraphQL inputs, or supporting
  long markdown project bodies.
- Splitting project GraphQL fragments or changing project resolution; that is
  Plan 002.
- Raw GraphQL stdin/schema behavior; it is already implemented and is tracked
  separately from this follow-up.
- Live Linear requests or mutations. All tests must continue to use
  `withMockGraphql` from `test/fixtures.ts`.
- Temporary files in the repository. If a file-input test is necessary, use
  an OS temporary directory and clean it up, or test the pure validation path
  without creating a repository fixture.

## Steps

### Step 1: Verify the field mapping and the source of the length policy

Inspect the locally available schema/cache and the published schema source
used by `scripts/validate-graphql-documents.ts`. Confirm that the current
documents’ mutation input fields and output fields are valid. Separately
record whether an authoritative source specifies the 255-character maximum
and what “character” means. This is a read-only schema check; it must not
execute a mutation or require Linear workspace data.

If the upstream schema does not expose an authoritative 255-character limit,
keep the limit because it is an explicit CLI requirement from the product
request, but describe it as a CLI policy rather than claiming Linear enforces
it. Do not remove the guard without maintainer approval.

**Verify**: `bun run schema:check` → exit 0 and all documents validate.

### Step 2: Make the public contract explicit

Update help and documentation so the following mapping is unambiguous:

- `project update --description` / `--description-file` changes the project’s
  short `Project.description` field and is limited to 255 characters by this
  CLI.
- `project post-update --body` / `--body-file` creates a separate
  `ProjectUpdate.body` status update and requires non-whitespace content.
- `--health` accepts only the exact values `onTrack`, `atRisk`, and `offTrack`.
- This scope intentionally does not expose a markdown `content` flag.

Keep the existing dry-run, `--apply`, no-op, and JSON-envelope descriptions
intact. Match the concise wording style used by neighboring issue/webhook
commands.

**Verify**: `bun run linear -- project update --help` and `bun run linear -- project post-update --help` → help names the two distinct fields and still shows `--apply` as opt-in.

### Step 3: Lock the boundary with mocked tests

Extend `test/project-workflows.test.ts` only where coverage is missing:

- exactly 255 characters are accepted and 256 are rejected;
- the existing non-empty-body rejection remains enforced for whitespace-only
  input;
- invalid health remains rejected before any mutation request;
- the mutation input uses `description` for project updates and `body` plus
  `health` for project-update creation.

Assert request counts and variables through `withMockGraphql`; do not invoke a
real Linear endpoint.

**Verify**: `bun run test -- test/project-workflows.test.ts` → all tests pass, including the new boundary assertions.

### Step 4: Run the repository gates

Run the focused checks, then the complete verification suite. Do not run with
`--apply` or use real credentials.

**Verify**: `bun run typecheck`, `bun run test`, `bun run schema:check`, and `bun run verify` → all exit 0.

## Test plan

Use `test/project-workflows.test.ts` and its existing `withMockGraphql`
pattern. The test set must cover the 255/256 boundary, whitespace-only body,
invalid health, and the exact GraphQL variables for each distinct mutation
field. No test may require a real Linear API key, workspace, or mutation.

## Done criteria

- [ ] Help and docs explicitly distinguish project description from update body.
- [ ] The 255-character rule is either sourced or clearly labeled as a CLI policy; the requested guard remains intact.
- [ ] Tests cover 255 accepted, 256 rejected, empty body rejected, invalid health rejected, and mutation input mappings.
- [ ] No `--content` or unrelated GraphQL/resolver behavior is introduced.
- [ ] `bun run typecheck` exits 0.
- [ ] `bun run test` exits 0.
- [ ] `bun run schema:check` exits 0.
- [ ] `bun run verify` exits 0.
- [ ] `git status --short` shows no modified files outside this plan’s scope and the pre-existing implementation changes.
- [ ] `plans/README.md` status row is updated.

## STOP conditions

Stop and report back if:

- The live schema rejects `description`, `body`, or `health` fields used by the
  current documents.
- The requested 255-character rule would require a different user-visible
  meaning of “character” than the current `Array.from` behavior and no product
  decision is available.
- Implementing the requested semantics appears to require adding `content` or
  changing the public JSON envelope.
- Any test would need a live Linear request or a repository temporary file.

## Maintenance notes

Future long-form project-body support should be a separate design decision with
its own flag, GraphQL input mapping, length/format contract, and tests. Review
any change to `Project.description`, `ProjectUpdate.body`, or the health enum
against this documented boundary before changing command names or JSON keys.
