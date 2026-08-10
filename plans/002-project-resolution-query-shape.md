# Plan 002: Separate project query payloads and unify resolution policy

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 07b7043 -- src/graphql/documents.ts src/commands/projects.ts src/commands/issues.ts test/project-workflows.test.ts test/issue-workflows.test.ts`
> The working tree intentionally contains the project-workflow implementation
> being reviewed. Compare the current excerpts below against the live code;
> do not reset or discard existing changes.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/001-project-field-contract.md` (the field contract must be settled before changing fragments/types)
- **Category**: tech-debt / performance / correctness
- **Planned at**: commit `07b7043`, 2026-08-10

## Why this matters

`PROJECT_FIELDS` currently includes five nested project updates and all detail
fields. That fragment is used by project list responses, name resolution,
direct ID lookup, and mutation results. As a result, an issue search or a
project name lookup pays for update payloads it does not use. The same resolver
also has divergent archive behavior: `getProject` defaults to archived
projects while team-scoped `resolveProject` hard-codes `includeArchived: false`.

Make the payload and archive policy explicit at call sites. Keep rich health,
date, and recent-update data for project detail JSON, while returning only the
fields needed for list/resolution paths. Preserve the current direct
`getProject`/mutation ability to address archived projects unless a product
decision says otherwise.

## Current state

- `src/graphql/documents.ts:683-714` defines `PROJECT_UPDATE_FIELDS` and one
  `PROJECT_FIELDS` fragment containing `id`, `name`, `url`, `description`,
  `state`, `health`, dates, status, and `projectUpdates(first: 5)`.
- `src/graphql/documents.ts:716-739` uses that same fragment for both
  `PROJECTS_QUERY` and `PROJECT_BY_ID_QUERY`.
- `src/commands/projects.ts:124-142` uses `PROJECTS_QUERY` for project list.
- `src/commands/projects.ts:144-172` uses direct ID lookup or `listProjects`
  for `getProject`; it defaults name resolution to `includeArchived: true`.
- `src/commands/projects.ts:174-197` implements team-scoped `resolveProject`
  with `fetchAllNodes` and hard-codes `includeArchived: false`.
- `src/commands/projects.ts:289-391` uses `getProject` for mutations and
  project-update listing; `listProjectUpdates` then performs a second query
  for updates.
- `src/commands/issues.ts:350-405` resolves `--project` with
  `resolveProject` when `--team` is present and with `getProject` otherwise,
  while issue result inclusion still defaults to `includeArchived: false`.
- `src/commands/projects.ts:394-408` human detail output needs rich fields;
  `formatProjectsList` at lines 410-423 only needs name, status, state, and id.
- Existing mocked request capture is provided by `test/fixtures.ts:7-42` and
  project behavior tests live in `test/project-workflows.test.ts`.

## Commands you will need

| Purpose                | Command                                                                                                                                                           | Expected on success                                                                      |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Drift check            | `git diff --stat 07b7043 -- src/graphql/documents.ts src/commands/projects.ts src/commands/issues.ts test/project-workflows.test.ts test/issue-workflows.test.ts` | Shows committed and uncommitted changes since the planned baseline; no reset or checkout |
| Focused project tests  | `bun run test -- test/project-workflows.test.ts`                                                                                                                  | All project workflow tests pass                                                          |
| Issue regression tests | `bun run test -- test/issue-workflows.test.ts`                                                                                                                    | All issue workflow tests pass                                                            |
| GraphQL schema check   | `bun run schema:check`                                                                                                                                            | Exit 0; all documents validate                                                           |
| Typecheck              | `bun run typecheck`                                                                                                                                               | Exit 0 with no errors                                                                    |
| Full verification      | `bun run verify`                                                                                                                                                  | Exit 0                                                                                   |

## Scope

**In scope** (the only source/tests to modify):

- `src/graphql/documents.ts` — introduce explicit reference/detail fragments
  and the minimum result types/queries needed to use them safely.
- `src/commands/projects.ts` — centralize project reference resolution,
  explicitly pass archive policy, and avoid fetching nested updates for
  list/resolution/update-list paths.
- `src/commands/issues.ts` — pass issue-search archive policy into project
  resolution consistently.
- `test/project-workflows.test.ts` — verify query shape, name/ID resolution,
  and archive variables.
- `test/issue-workflows.test.ts` — add the team-scoped `--project` archive
  regression if that is the least coupled existing test location.
- `README.md` and `docs/implementation.md` — document the archive-policy
  matrix and the lean-vs-detail read distinction.

**Out of scope** (do not touch):

- Project command names, input flags, or the `--description`/`--body` field
  semantics; Plan 001 owns that contract.
- Raw GraphQL stdin/schema validation; it is already a separate completed
  workstream.
- A broad GraphQL client rewrite or pagination redesign.
- Any real Linear data access or mutation. Tests must use mocked GraphQL.
- Human-readable project table redesign or changing the global JSON envelope.

## Target policy

Use one resolver API with an explicit `includeArchived` argument. Defaults are
set by the command’s intent, not hidden inside multiple helpers:

| Caller                              |                                                                      Default archive policy | Reason                                                           |
| ----------------------------------- | ------------------------------------------------------------------------------------------: | ---------------------------------------------------------------- |
| `project list`                      |                                                                                     `false` | Discovery should show active projects unless requested otherwise |
| `issue search --project`            |                                         `false`, or the explicit `--include-archived` value | Project resolution must match the issue search scope             |
| `project get` and project mutations |                                     Preserve the current direct-reference default of `true` | Avoid breaking existing ability to address archived projects     |
| `project updates`                   | Use the command’s explicit policy consistently for both project resolution and update query | Do not resolve one archive scope and list another                |

If the maintainer chooses a different matrix, record it in the implementation
notes and update all callers together. The important invariant is that every
resolver call receives an explicit boolean and that team-scoped and
workspace-scoped issue search do not silently disagree.

## Steps

### Step 1: Define reference and detail GraphQL shapes

In `src/graphql/documents.ts`, split the current all-purpose fragment into:

- a lean project reference/list fragment containing the fields needed for
  identity and list formatting (`id`, `name`, `url`, `state`, and status
  identity/display fields);
- a detail fragment containing description, health, dates, status, and the
  five recent `projectUpdates` entries;
- a mutation-result shape only if TypeScript otherwise falsely promises nested
  updates that the mutation response no longer selects.

Use the lean fragment for list and reference-resolution queries. Use the detail
fragment for direct project JSON reads. Do not remove fields from the result
that the current `formatProject` or project mutation result contract needs
without adding an explicit type and test.

**Verify**: `bun run schema:check` → exit 0; the schema accepts every new document shape.

### Step 2: Centralize resolution and make archive behavior explicit

Refactor `getProject`/`resolveProject` around one internal resolver path that
accepts the project ref, optional team scope, `includeArchived`, and debug
options. Preserve the existing case-insensitive exact-name matching and
`singleMatch` ambiguity/no-match errors. Keep direct ID lookup efficient.

Ensure name resolution can return a lean reference and then fetch detail only
when the caller needs detail/current mutation state. `listProjectUpdates` needs
the project id/name plus its separate update query; it should not fetch five
nested updates as part of project resolution.

Pass explicit archive values from every caller. In particular, change
`searchIssues` so both the team-scoped `resolveProject` path and the
workspace-scoped `getProject` path use `options.includeArchived ?? false` for
project resolution, matching the issue query variables.

**Verify**: `bun run typecheck` → exit 0; no caller relies on an old resolver signature.

### Step 3: Update mocked tests for payload and policy regressions

Add tests using `withMockGraphql` that assert:

- `PROJECTS_QUERY`/list and project-reference resolution do not contain the
  nested `projectUpdates` selection;
- direct project detail JSON still contains health, dates, and recent updates;
- `project updates` resolves once and sends the same archive policy to its
  updates query;
- workspace-scoped `issue search --project` passes the requested archive
  policy while team-scoped search passes the same policy through
  `resolveProject`;
- no-match and ambiguous-name errors remain unchanged.

Prefer request-variable assertions over snapshots. Keep all responses mocked
and avoid repository temp files.

**Verify**: `bun run test -- test/project-workflows.test.ts test/issue-workflows.test.ts` → all selected tests pass.

### Step 4: Run all repository gates

Run the complete suite after the focused tests. Do not pass `--apply` and do
not use live Linear credentials.

**Verify**: `bun run typecheck`, `bun run test`, `bun run schema:check`, and `bun run verify` → all exit 0.

## Test plan

Use `test/fixtures.ts:7-42` for request capture and existing project/issue
workflow tests as structural exemplars. The regression suite must exercise
both project query selection shape and variables, because a response-only
mock would not detect over-fetching or an archive-policy mismatch.

## Done criteria

- [ ] List and reference queries no longer request nested recent updates.
- [ ] Project detail JSON still includes health, start date, target date, and recent updates.
- [ ] One resolver path owns matching/error behavior and accepts explicit archive policy.
- [ ] Team-scoped and workspace-scoped `issue search --project` use the same archive policy as issue search.
- [ ] `project updates` uses one consistent archive policy for resolution and update listing.
- [ ] Existing name/ID, ambiguity, no-match, dry-run, apply, and no-op behavior remains covered.
- [ ] `bun run typecheck` exits 0.
- [ ] `bun run test` exits 0.
- [ ] `bun run schema:check` exits 0.
- [ ] `bun run verify` exits 0.
- [ ] No files outside the in-scope list are modified, aside from the plan index.
- [ ] `plans/README.md` status row is updated.

## STOP conditions

Stop and report back if:

- The GraphQL schema cannot represent a lean reference query without changing
  an unrelated API surface.
- A type change would alter the documented `--json` shape for an existing
  command and there is no compatibility decision.
- The correct archived-project policy cannot be chosen from the matrix above
  without a maintainer decision.
- A resolver refactor requires changing notification/admin callers outside the
  listed scope.
- Any test would require a live Linear request or mutation.

## Maintenance notes

Keep reference and detail fragments named by payload intent so future fields do
not silently return to every resolver path. When adding a project command,
choose its archive policy explicitly and use the shared resolver rather than
calling `PROJECTS_QUERY` directly. Review the `projectUpdates` selection in any
new query for payload size and pagination implications.
