# Foundry Orchestrator Migration, Archive, And Release Plan

Status: Draft for review
Date: 2026-03-12
Primary repo: `foundry`
Current branch: `codex/foundry-pr1-integration`

## 1. Objective

This plan covers four linked outcomes:

1. Migrate Meridian Coder Orchestrator into the Foundry codebase and Foundry-owned deployment path.
2. Commit the current in-flight Foundry work into the `foundry` repository in a controlled way.
3. Move superseded legacy code into an `archive` area with a clear `README.md` marking it as legacy.
4. Deploy the merged result to Foundry dev, validate it in the real UI, and only then promote it to production through an explicit production release gate.

This is a migration and release plan only. It is not an authorization to skip validation, compress unrelated work into one opaque commit, or push directly to production without an agreed production rollout path.

## 2. Current State Summary

### 2.1 Repository and worktree reality

- The top-level workspace is not a git repository.
- `foundry` is the active git repository and already contains the product-facing code we need to ship.
- The current `foundry` worktree is dirty:
  - `47` status entries are present.
  - `40` tracked files currently show diff content.
  - the current diff is large and product-significant, with about `3103` insertions and `424` deletions.
- Configured remotes:
  - `meridian` -> `https://git.meridian.cv/meridian/foundry.git`
  - `origin` -> `https://github.com/aldrinc/foundry.git`

### 2.2 Foundry product boundary

The repository already states the intended direction:

- `services/foundry-server` is the intended home for runtime settings, workspace orchestration policy, and public control-plane APIs.
- `services/foundry-core` remains the imported collaboration server boundary.
- `services/foundry-core/app/zerver/views/foundry_tasks.py` currently proxies many Foundry orchestration routes to an external orchestrator service.

### 2.3 Legacy orchestrator boundary

The current Meridian Coder Orchestrator lives outside the `foundry` git repo at:

- `/Users/aldrinclement/Documents/programming/ideas-space/infra/hetzner-apps/meridian-coder-orchestrator`

It is currently:

- a standalone FastAPI service
- deployed separately from Foundry
- backed by its own SQLite state store
- coupled to companion runtime pieces including Moltis and `repo_management_mcp`

### 2.4 Dev deployment reality

The current dev runbook documents:

- `zulip-dev-live` on `5.161.60.86` as the active Foundry Core dev surface
- `foundry-server-dev.service` on the apps host as the side-by-side Foundry Server dev control plane
- the legacy `meridian-coder-orchestrator` still running on the apps host

Known dev URLs and hosts referenced in current docs:

- `https://zulip-dev-live.5.161.60.86.sslip.io`
- `https://foundry-labs.zulip-dev-live.5.161.60.86.sslip.io`
- `foundry-server-dev.178.156.253.167.sslip.io`

### 2.5 Important constraint

The repository documents a dev deployment path, but it does not provide a similarly clear finalized production promotion runbook for this migration. That means production push is a gated step in this plan, not an unconditional last command.

## 3. Planning Decisions

### 3.1 Target home for migrated orchestration code

Recommended target:

- `services/foundry-server/src/foundry_server/orchestration/`

Rationale:

- `services/foundry-server` is already defined as the Foundry-owned control plane.
- The repository explicitly says orchestration and workspace policy should continue migrating into this service.
- This avoids treating `services/foundry-core` as the permanent home for orchestration policy.

### 3.2 API compatibility strategy

Keep the outer product API stable during the migration:

- desktop keeps talking to the existing Foundry/Core-facing routes
- Foundry Core continues to expose the same supervisor/task/provider surfaces during transition
- the backend implementation target changes behind that seam

This reduces desktop breakage and lets us cut over incrementally.

### 3.3 Archive strategy

Do not archive anything that is still serving dev or production traffic.

Recommended archive destination inside the `foundry` repo:

- `archive/legacy/`

Recommended first archive package after cutover:

- `archive/legacy/meridian-coder-orchestrator/`

Each archived package must include a local `README.md` that says:

- this code is legacy
- it is not the current Foundry runtime path
- when it was archived
- what replaced it
- whether it is retained for reference only or temporary rollback support

### 3.4 History preservation warning

Because the legacy orchestrator currently sits outside the `foundry` git repository, moving it into `foundry` will not automatically preserve file history inside the `foundry` repo.

We need an explicit decision:

- either copy/import the current code snapshot into `foundry` and accept fresh git history there
- or locate the original source repo history and import it deliberately via a repository-history-preserving method

Until that decision is made, the default plan should assume snapshot import into `foundry`.

## 4. Scope

### In scope

- migration of Meridian Coder Orchestrator code into Foundry ownership
- migration of its runtime and data dependencies into Foundry deployables
- commit strategy for the current dirty Foundry worktree
- archive structure and legacy `README.md`
- dev deployment, real UI validation, and production release gating

### Out of scope for the first slice

- deleting all Meridian naming everywhere in one pass
- collapsing `services/foundry-core` and `services/foundry-server` into one server
- undocumented production push without a rollback plan
- broad archival of every old planning note in the top-level workspace

## 5. Workstreams

### WS-0: Freeze decisions and inventory

Goals:

- define the exact target service boundary
- define the archive boundary
- define the release boundary

Tasks:

1. Freeze the target home for orchestration logic under `services/foundry-server`.
2. Inventory the legacy orchestrator modules that must move:
   - `app.py`
   - `executor.py`
   - `store.py`
   - `coder_api.py`
   - `control_commands.py`
   - `orchestrator_policy.py`
   - `repo_management_mcp.py`
   - `supervisor_runtime/`
   - validation scripts
   - Docker/runtime files
3. Inventory the Foundry files already touched in the dirty worktree and bucket them into:
   - already-needed product work
   - migration-enabling work
   - unrelated or opportunistic work
4. Freeze the archive candidate list.
5. Confirm the production release authority, host, service names, and rollback owner.

Exit criteria:

- a signed-off ownership map exists
- the archive candidate list exists
- the production clarification gate is explicit

### WS-1: Land the current dirty Foundry worktree safely

Goals:

- avoid burying current work under the migration
- create a reviewable baseline inside `foundry`

Tasks:

1. Review the current dirty worktree by feature area.
2. Run all affected tests and fix any failures before committing.
3. Commit the current in-flight Foundry changes as a controlled baseline.
4. Prefer logical commits by concern. If a single baseline commit is required for speed, label it explicitly as a pre-migration integration snapshot.
5. Push the baseline branch to the `meridian` remote for review visibility.

Rules:

- do not mix archive moves into the baseline commit
- do not mix unreviewed migration scaffolding into the baseline commit unless necessary
- do not declare the baseline complete until tests pass

Exit criteria:

- current Foundry work is committed and reviewable
- the remaining worktree contains only intentional migration deltas

### WS-2: Move orchestration into Foundry Server

Goals:

- make Foundry own the orchestration code path
- keep product-facing APIs stable while moving the implementation

Tasks:

1. Create a Foundry Server orchestration package under:
   - `services/foundry-server/src/foundry_server/orchestration/`
2. Port the legacy orchestrator modules into that package.
3. Separate code into stable subdomains:
   - API layer
   - task coordination and lifecycle management
   - runtime adapters
   - store abstraction
   - supervisor runtime utilities
   - MCP/repo access integration
4. Re-home orchestration-specific config into Foundry Server config conventions.
5. Expose a Foundry-owned internal API surface for orchestration operations.
6. Keep Foundry Core route contracts stable while retargeting the implementation.

Exit criteria:

- orchestration code builds and runs from inside the `foundry` repo
- Foundry Core can talk to the Foundry-owned orchestration implementation
- the legacy external app is no longer the primary source path in dev

### WS-3: Replace the legacy external seam

Goals:

- remove the dependency on a separately managed Meridian app path
- make Foundry Core use a Foundry-owned internal service target

Tasks:

1. Replace the current raw proxy seam with a typed client or service adapter owned by Foundry.
2. Rename config from legacy Meridian-only names to Foundry-owned names, while keeping temporary compatibility fallbacks.
3. Re-point Foundry Core supervisor/task/provider routes to the Foundry-owned orchestration service.
4. Keep streaming behavior, timeouts, and error shapes stable for desktop consumers.

Exit criteria:

- Foundry Core no longer depends on the legacy apps-host Meridian orchestrator path for primary operation
- compatibility fallbacks are optional rather than required

### WS-4: Migrate state and secrets

Goals:

- remove dependence on the legacy SQLite store
- move sensitive data into a Foundry-owned persistence path

Current legacy state includes:

- `workspace_mappings`
- `topic_repo_bindings`
- `tasks`
- `task_events`
- `worker_sessions`
- `plan_revisions`
- `provider_credentials`
- `provider_oauth_states`
- `integration_credentials`
- `integration_policies`
- `supervisor_sessions`
- `supervisor_events`

Tasks:

1. Design the Foundry-owned persistence shape.
2. Move non-secret workflow state first:
   - tasks
   - task events
   - worker sessions
   - supervisor sessions/events
   - plan revisions
   - workspace mappings
   - topic repo bindings
3. Move provider and integration credentials into a secure Foundry-owned storage path.
4. Add a migration/import tool from the legacy SQLite database.
5. Add reconciliation checks so migrated rows and live rows match expected counts and key identifiers.

Exit criteria:

- the new Foundry-owned service reads and writes state without relying on the legacy SQLite file
- credential storage is defined and implemented safely

### WS-5: Dev deploy and real UI validation

Goals:

- prove the migrated path works in the actual product UI
- satisfy the delivery criteria before any production promotion

Tasks:

1. Extend the current Foundry dev deployment flow so it deploys:
   - Foundry Core DevLive
   - Foundry Server dev
   - Foundry-owned orchestration runtime
   - required runtime companions
2. Deploy to the active dev environment.
3. Validate manually in the real UI:
   - provider auth load
   - provider connect/disconnect
   - supervisor open/send/stream
   - upload forwarding
   - topic transcript injection
   - plan generation and revision
   - `BEGIN_WORK`
   - worker dispatch
   - lifecycle reactions
   - verification task flow
4. Hand the deployed dev environment to the user for testing.

Exit criteria:

- the migrated behavior is usable in the dev UI
- the user has a real environment to validate
- regressions are fixed before production promotion

### WS-6: Archive the superseded legacy code

Goals:

- preserve reference material without leaving it on the active path
- make the repo boundary obvious to future contributors

Tasks:

1. Create:
   - `archive/legacy/README.md`
2. Create:
   - `archive/legacy/meridian-coder-orchestrator/README.md`
3. Move only superseded code after the dev cutover is proven.
4. Update active docs and scripts so nothing points at archived paths.
5. Add a short archive policy note:
   - archived code is read-only
   - archived code is not part of the active build/deploy pipeline
   - archived code may be deleted later after a retention window

Required archive README content:

- title: `Legacy Code`
- statement: `This directory contains legacy code and historical deployment artifacts. It is not part of the active Foundry runtime path.`
- archived date
- source path
- replacement path
- rollback note

Exit criteria:

- no active dev or production path depends on archived locations
- the archive is clearly marked as non-active

### WS-7: Production release

Goals:

- promote only after dev validation and explicit operational sign-off

Blocking prerequisite:

- production deploy target, service path, release command path, and rollback procedure must be confirmed

Tasks:

1. Freeze the release branch/commit set.
2. Ensure the worktree is clean and tagged with the release candidate commit.
3. Push reviewed commits to the canonical remote/branch for production release.
4. Deploy through the normal Foundry production build/deploy pipeline.
5. Run post-deploy smoke checks.
6. Validate the critical UI workflows again in production.
7. Keep legacy compatibility paths in place until the production burn-in period completes.
8. Only after burn-in:
   - disable legacy service references
   - remove temporary env fallbacks
   - finalize archive status

Exit criteria:

- production is serving the Foundry-owned orchestration path
- the user confirms the production UI works
- rollback remains documented until burn-in completes

## 6. Commit Strategy

Recommended commit sequence:

1. `foundry: baseline current supervisor/ui/backend worktree`
2. `foundry-server: import orchestration runtime from legacy Meridian service`
3. `foundry-core: retarget orchestration routes to Foundry-owned service`
4. `foundry-server: migrate workflow state and credential handling`
5. `infra: deploy Foundry-owned orchestration in dev stack`
6. `archive: move superseded Meridian orchestrator code under archive/legacy`
7. `release: finalize production rollout and remove temporary compatibility paths`

If the current worktree must be committed immediately before deeper review, treat that as commit `1` only, not as the entire migration.

## 7. Validation Matrix

The migration is not done until all of the following are true:

- tests pass at 100%
- the Foundry dev stack is deployed and reachable
- the user can exercise the workflow in the real UI
- current supervisor flows still work
- migrated orchestration flows still work
- no active runtime depends on archived code
- the production deployment path has been executed and verified
- the user confirms production behavior is acceptable

## 8. Risks

### High risk

- moving legacy code from outside the `foundry` repo without preserved git history
- mixing the existing dirty worktree with migration work and making review impossible
- attempting a production push without a documented production rollout and rollback path
- archiving code too early while dev or prod still references it

### Medium risk

- leaking legacy Meridian naming into the new Foundry-owned service boundary
- breaking desktop supervisor flows while changing the internal orchestration target
- incomplete credential migration or auth fallback behavior

## 9. Explicit No-Go Conditions

Do not push to production if any of the following are true:

- production target and rollback owner are still unclear
- the migrated path only works locally and not in the dev UI
- the Foundry worktree includes unreviewed unrelated changes
- legacy code has been archived before the replacement path is live
- tests are failing

## 10. Recommended Immediate Next Actions

1. Review this plan and confirm the target home is `services/foundry-server`.
2. Confirm whether snapshot import into `foundry` is acceptable for legacy code history.
3. Confirm the intended production deploy target and promotion command path.
4. After that confirmation, start with:
   - worktree audit
   - baseline commit of current Foundry changes
   - orchestration package import into Foundry Server

## 11. Review Request

This plan is intentionally conservative about production push and archival timing.

That is deliberate. The current repository context supports a safe dev migration path, but it does not yet justify an immediate production push without an explicit release gate.
