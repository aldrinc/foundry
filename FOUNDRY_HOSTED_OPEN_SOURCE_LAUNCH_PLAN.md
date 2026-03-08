# Foundry Hosted + Open Source Launch Plan

Date: 2026-03-08
Status: Draft for review
Owner: Foundry product + platform engineering

## Purpose

This document outlines the work required to turn the current Foundry codebase and backend foundations into:

1. A downloadable open source desktop app.
2. A hosted Foundry Cloud service that users can sign up for.
3. A self-hostable server path for teams that want to run Foundry themselves.

This plan assumes:

- GitHub is the only source-control integration for v1.
- GitLab is explicitly deferred.
- Coder remains the workspace provisioning backend for v1.
- Workspace tenancy for v1 is primarily org-scoped.
- Billing is required for the hosted offer.
- Agent and Moltis runtime configuration fixes are launch-critical, not optional polish.
- Desktop launch target is cross-platform: macOS, Windows, and Linux.

## Desired End State

### Cloud user journey

1. User lands on Foundry marketing/app site.
2. User signs up for Foundry Cloud.
3. User creates or joins an organization.
4. User selects a plan and enters payment details if required.
5. User downloads the Foundry desktop app.
6. User signs into Foundry Cloud from the desktop app.
7. User connects GitHub.
8. User selects repositories or grants repo access.
9. Foundry provisions coding capacity through Coder.
10. User configures agents/runtime defaults if needed.
11. User starts working in Foundry.

### Self-host user journey

1. Operator deploys the Foundry server stack.
2. Operator configures GitHub integration, Coder integration, Moltis/runtime settings, and storage/secrets.
3. User downloads the Foundry desktop app.
4. User chooses the self-host setup path on first run.
5. User points the app at the self-hosted Foundry server.
6. User signs in and uses the same core product flows as cloud users.

## Current Repo Reality

The current codebase already has useful foundations, but it is not launch-ready.

### What exists today

- A Tauri desktop app under `foundry/packages/desktop`.
- A shared app UI under `foundry/packages/app`.
- A partial Foundry rebrand.
- A backend/orchestration foundation under `infra/hetzner-apps/meridian-coder-orchestrator`.
- Existing supervisor/task/provider plumbing.
- Existing GitHub and self-hosted git integration primitives in the orchestrator.
- Existing Coder workspace orchestration foundations.
- A sanitized imported snapshot of the customized Zulip-derived application server now lives under `foundry/services/foundry-core/app`.

### Important current gaps

- The desktop app is still structurally and textually a Zulip desktop client in many places.
- The renamed core application server is present as an imported snapshot, but it is not yet standardized or fully rebranded inside the `foundry` monorepo.
- The login flow is still URL + email + API key, which is operator-grade rather than SaaS-grade.
- There is no hosted account/org/billing model.
- There is no public release pipeline for GitHub distribution.
- There is no Stripe or subscription handling in the current stack.
- GitHub exists as an integration foundation, but not yet as a polished end-user product flow.
- Agent configuration is still partly local-only and not organized as a proper server-backed settings system.
- Moltis/runtime configuration is not easy for normal admins to understand or manage.

## Product Boundary Decisions

These decisions should be made and written down before major implementation begins.

### 1. What Foundry is

Foundry should be treated as a product with these top-level components:

- `foundry-desktop`: the desktop app users install.
- `foundry-core`: the renamed Zulip-derived application server that provides the core collaboration product.
- `foundry-server`: the public backend/control plane around auth, billing, GitHub, runtime, and workspace orchestration.
- `foundry-worker-orchestrator`: task orchestration and workspace control.
- `foundry-cloud-web`: the hosted account, billing, onboarding, and download surface.

### 2. What is open source

Recommended:

- Open source the desktop app.
- Open source the self-hostable server path.
- Open source deployment docs and local dev tooling.
- Keep hosted operational secrets, billing operations, cloud environment config, and internal support tooling private.

### 3. Hosted vs self-host parity

Recommended:

- Keep one product model.
- Cloud and self-host should share the same core feature set for v1.
- Differences should mostly be operational:
  - hosted billing and account provisioning in cloud
  - manual infra setup in self-host
  - managed defaults in cloud

Avoid creating two separate products.

## Launch Principles

- Do not optimize for every integration. Optimize for one excellent GitHub path.
- Do not keep operator-grade UX where product UX is required.
- Do not leave agent/runtime setup as an internal-only concept.
- Do not split authority for important settings between local storage and server state unless there is a strong reason.
- Do not defer packaging, signing, updater, and OSS hygiene to the end.

## Confirmed Decisions

The following decisions are currently treated as confirmed unless revised in review:

- GitHub is the only SCM integration for v1.
- GitHub integration for v1 is built primarily on a GitHub App.
- Agent and Moltis runtime configuration is a launch-blocking workstream.
- Workspace tenancy is primarily org-scoped rather than `org + repo` scoped.
- Billing for v1 starts with a hybrid model.
- The desktop product launches cross-platform on macOS, Windows, and Linux.

## Open Questions Still Requiring Explicit Decisions

- Do we want one repo or multiple repos for desktop, server, and cloud web?
- Do we want product auth to be built around external OIDC, a custom auth stack, or another managed auth approach?
- Do we want runtime/provider credentials to be org-owned by default, user-owned by default, or mixed by capability?
- Do we want the web surface to remain onboarding/admin-only for v1, or do we expect real daily product usage there too?

## Phase Structure

Recommended high-level sequence:

1. Architecture and repo strategy.
2. Backend promotion into a public Foundry server.
3. Hosted auth, orgs, and billing.
4. GitHub integration and Coder hardening.
5. Desktop onboarding and settings redesign.
6. Agents and Moltis/runtime configuration.
7. Open source readiness and release automation.
8. Launch validation and operations hardening.

## Detailed Workstreams

## Workstream 1: Product Architecture and Repo Strategy

### Goal

Turn the current mixed structure into a coherent public product architecture.

### Tasks

- Decide which current Zulip-derived source tree is canonical for the renamed core application server and import it into the monorepo.
- Decide whether the orchestrator remains a separate service or becomes a package within a new `foundry-server` project.
- Define service boundaries between:
  - desktop client
  - core application server
  - server/control plane
  - workspace/orchestration worker
  - cloud web/billing/onboarding site
- Define public API boundaries and internal-only APIs.
- Decide where shared models live.
- Decide how org-level settings, agent definitions, provider config, runtime config, and SCM config are persisted.
- Define config strategy for:
  - local development
  - self-host production
  - Foundry Cloud staging
  - Foundry Cloud production

### Deliverables

- Architecture decision record.
- Service boundary diagram.
- Import plan for the renamed core application server.
- Public repo/package layout decision.
- Initial data model draft for users, orgs, billing, SCM, workspaces, agents, and runtime config.

### Acceptance criteria

- Every major product concept has a clear system of record.
- The team can explain where each feature will live before implementation starts.

## Workstream 2: Foundry Rebrand Completion

### Goal

Remove remaining Zulip-era naming and make the product legible as Foundry.

### Tasks

- Rename remaining package metadata, imports, UI text, and docs.
- Audit onboarding, settings, notifications, help text, menu items, and default asset names.
- Decide how much Zulip terminology remains visible to end users.
- Standardize repo and release naming for:
  - app bundle IDs
  - package names
  - docs
  - screenshots
  - release artifacts
- Clean internal default URLs and references that assume Meridian or Zulip-specific infrastructure.

### Deliverables

- Naming audit.
- Rebrand cleanup PR set.
- Updated README and screenshots.

### Acceptance criteria

- A new contributor can inspect the repo and understand it as Foundry, not as a renamed Zulip fork with partial branding.

## Workstream 3: Public Foundry Server

### Goal

Turn the current orchestrator/backend foundation into a clean product server.

### Tasks

- Promote the current internal orchestrator into a public-facing `foundry-server` service layout.
- Add explicit modules for:
  - auth/session management
  - organizations and memberships
  - billing and entitlements
  - GitHub integration
  - runtime/provider config
  - agent definitions
  - workspace provisioning
  - supervisor/task APIs
- Replace internal-only config assumptions with documented environment and secrets contracts.
- Add migrations and stable schema management.
- Add staging and production config support.
- Add admin endpoints or admin tools for support operations.

### Deliverables

- Foundry server package/service.
- Migration system.
- Stable config and deployment docs.

### Acceptance criteria

- The server can be deployed without relying on hidden internal knowledge.
- Settings and org state are stored centrally and intentionally.

## Workstream 4: Hosted Accounts, Organizations, and Auth

### Goal

Create a real Foundry Cloud identity and org model.

### Tasks

- Define user, org, membership, role, invitation, and session models.
- Build signup and sign-in flows for Foundry Cloud.
- Build email verification and password reset if using password auth.
- Alternatively, choose external auth and formalize it.
- Build org creation and invite flows.
- Support org switching.
- Define admin roles for billing, SCM, workspace settings, and agent/runtime settings.
- Build browser-to-desktop auth handoff for desktop login.

### Deliverables

- Hosted auth system.
- Org and membership management.
- Desktop auth handoff flow.

### Acceptance criteria

- A new cloud user can create an account, create an org, install the app, and sign into the app without using manual API keys.

## Workstream 5: Billing and Entitlements

### Goal

Add the minimum SaaS billing system required to sell Foundry Cloud.

### Tasks

- Choose Stripe as the billing provider.
- Use a hybrid pricing model for v1.
- Define the hybrid billing structure explicitly:
  - seat-based component
  - usage-based component
  - any workspace-based component only if it is simple to explain and enforce
- Define plan tiers and what they unlock.
- Implement:
  - checkout
  - subscription lifecycle
  - free trial rules
  - billing portal
  - payment method updates
  - invoices and receipts
  - webhook handling
  - failure/recovery behavior
- Map plans to entitlements:
  - workspace counts
  - user seats
  - runtime/provider availability
  - usage caps
  - support tier
- Add server-side enforcement.
- Add org billing settings UI.

### Deliverables

- Billing service integration.
- Plan and entitlement model.
- Billing UI for cloud org admins.

### Acceptance criteria

- Billing state changes are reflected in the product without manual intervention.
- Subscription and entitlement behavior is enforced by the server.

## Workstream 6: GitHub Integration for v1

### Goal

Make GitHub setup clean, reliable, and understandable.

### Scope decision

GitLab is out of scope for v1.

### Tasks

- Use a GitHub App as the primary GitHub integration model for v1.
- Define whether any GitHub OAuth support is needed later for identity or edge-case user-scoped actions.
- Define permissions model for private repos and org repos.
- Build user/org GitHub connection flow.
- Build repo selection and repo binding UI.
- Support:
  - repo discovery
  - clone/pull authentication
  - branch creation
  - PR creation
  - PR status display
  - review state
  - CI/check status
- Handle common failures:
  - missing scopes
  - revoked tokens
  - org app not installed
  - repo not granted
  - private repo access denied
- Add org-level admin guidance for GitHub setup.

### Deliverables

- Production-ready GitHub integration flow.
- Repo connection and permission UX.
- Error handling and support guidance.

### Acceptance criteria

- A normal admin can connect GitHub and successfully enable private repo workflows without backend shell access.

## Workstream 7: Coder Workspace Provisioning Hardening

### Goal

Turn existing workspace orchestration into a hosted-grade operational path.

### Tasks

- Define workspace template strategy for v1.
- Define naming and ownership model for org-scoped workspaces.
- Define how multiple repos are represented within an org-scoped workspace model.
- Define repo mirror, checkout, and worktree strategy inside each org workspace.
- Define branch, task, and file-level isolation rules so work in one repo does not interfere with work in another.
- Define per-org quotas and concurrency limits.
- Standardize bootstrap process for coding environments.
- Add secrets injection strategy.
- Add idle stop, cleanup, and recovery behavior.
- Add explicit retry/reconciliation for failed provisioning.
- Add auditability around workspace creation, start, extension, and teardown.
- Add admin visibility into current workspaces and health.
- Add org settings for workspace policy where appropriate.

### Deliverables

- Stable workspace lifecycle rules.
- Stable org-scoped multi-repo workspace model.
- Operator/admin observability for workspace state.
- Hardened Coder configuration for cloud and self-host.

### Acceptance criteria

- Workspace provisioning does not depend on manual babysitting in normal operation.
- An org can safely use many repos without needing one long-lived workspace per repo.

## Workstream 8: Desktop Onboarding Redesign

### Goal

Replace operator-first login with a real product onboarding path.

### Tasks

- Add first-run split:
  - `Use Foundry Cloud`
  - `Connect to Self-hosted Foundry`
- For cloud:
  - open browser auth flow
  - return to app with session handoff
  - show org selection or auto-enter org
- For self-host:
  - accept server URL
  - validate server capabilities
  - proceed through auth and setup
- Add onboarding copy that explains:
  - what Foundry is
  - what is required
  - what GitHub connection enables
- Add recovery paths for expired session, revoked auth, missing org membership, and server mismatch.

### Deliverables

- New first-run flow.
- Cloud auth handoff.
- Self-host connection flow.

### Acceptance criteria

- A non-technical cloud user can sign in without seeing API key instructions.

## Workstream 9: Settings Redesign

### Goal

Create a settings structure that matches the actual product.

### Recommended settings IA

- Account
- Organization
- GitHub
- Agents
- Runtime
- Workspaces
- Billing
- Desktop
- Self-host / Server

### Tasks

- Audit current settings surfaces and map them to the new IA.
- Separate desktop-local settings from server-backed settings.
- Add role-aware visibility.
- Add validation and health states to settings screens.
- Ensure settings changes are explainable and reversible where practical.

### Deliverables

- Settings IA and navigation redesign.
- Server-backed settings model.

### Acceptance criteria

- A customer admin can discover and manage core product settings without tribal knowledge.

## Workstream 10: Agents and Moltis Runtime Configuration

### Goal

Fix the current agent/runtime setup gap and make it launch-ready.

### Why this is launch-critical

The current app shows provider/runtime state and local delegate definitions, but it does not yet provide a straightforward end-user workflow for configuring the Moltis runtime, default providers, models, or server-backed agent policy. This must be treated as core product work.

### Required product outcomes

- Org admins can understand what runtime powers Foundry.
- Org admins can see whether the runtime is healthy.
- Org admins can connect/configure required provider credentials.
- Org admins can choose sensible defaults without editing raw config files.
- Agent definitions are shared across devices through the server.

### Tasks

- Move agent definitions from local-only storage to server-backed persistence.
- Define org-level runtime settings model:
  - runtime engine
  - provider availability
  - provider credential source
  - default provider
  - default model
  - per-agent overrides
  - runtime policy flags
- Add settings UI for:
  - provider state
  - provider auth status
  - default model selection
  - runtime health
  - test connection
  - save/apply feedback
- Add server APIs for reading/updating agent and runtime settings.
- Add migration path from existing local delegate storage.
- Define which settings are org-level vs user-level.
- Add clear error and validation states:
  - runtime unavailable
  - no provider configured
  - invalid provider credential
  - no compatible model
  - agent override conflicts
- Add a reasonable default experience for first-time admins.

### Deliverables

- Server-backed agent catalog.
- Runtime settings APIs.
- New Agents and Runtime settings UX.
- Connection validation tooling.

### Acceptance criteria

- An org admin can configure the runtime and agents without touching env vars or internal files.
- Settings sync across devices and sessions.

## Workstream 11: Self-host Productization

### Goal

Make self-host an intentional supported path, not an accidental internal setup.

### Tasks

- Publish self-host deployment docs.
- Provide environment templates for:
  - Foundry server
  - orchestrator/worker
  - GitHub integration
  - Coder integration
  - Moltis/runtime config
- Provide deployment examples:
  - Docker Compose for v1
  - optional Helm/Terraform later
- Document storage, secrets, backup, and upgrade procedures.
- Document desktop app connection flow for self-host instances.
- Decide which features are unsupported or limited in self-host if any.

### Deliverables

- Self-host quickstart.
- Self-host operator docs.
- Example deployment manifests.

### Acceptance criteria

- A motivated technical operator can deploy Foundry from public docs alone.

## Workstream 12: Open Source Readiness

### Goal

Prepare the repo for public GitHub distribution.

### Tasks

- Add:
  - `LICENSE`
  - `CONTRIBUTING.md`
  - `SECURITY.md`
  - `CODE_OF_CONDUCT.md`
- Write contributor setup docs.
- Write architecture overview docs.
- Remove or replace internal-only defaults and references.
- Ensure secrets and local state are not committed.
- Review code and docs for assumptions about private infra and private hostnames.
- Add issue templates and PR templates if desired.

### Deliverables

- Public repo hygiene set.
- OSS contributor docs.

### Acceptance criteria

- The repo can be made public without obvious missing governance or onboarding docs.

## Workstream 13: Desktop Packaging, Updates, and Release Automation

### Goal

Make the desktop app downloadable and maintainable as a public product.

### Tasks

- Treat macOS, Windows, and Linux as first-class release targets for v1.
- Build public CI/CD for:
  - desktop bundles
  - signed artifacts
  - GitHub Releases
  - updater manifests
- Build and validate a cross-platform release matrix:
  - macOS
  - Windows
  - Linux
- Configure:
  - macOS signing
  - macOS notarization
  - Windows signing
  - Linux packaging and install validation
  - updater key management
- Publish a downloads page or release feed.
- Validate install, update, and rollback behavior.

### Deliverables

- Public release pipeline.
- Signed and validated installers where platform conventions support signing.
- Working updater path.
- Cross-platform release checklist and verification matrix.

### Acceptance criteria

- A user can download and install Foundry on macOS, Windows, and Linux from a public release source with no manual build steps.

## Workstream 14: Cloud Operations, Security, and Supportability

### Goal

Make the hosted service operable and supportable.

### Tasks

- Add secret management strategy.
- Add audit logs for critical admin actions.
- Add monitoring and alerting for:
  - auth
  - billing webhooks
  - GitHub integration
  - workspace provisioning
  - runtime availability
- Add error reporting and tracing.
- Add backup and restore plans.
- Add incident playbooks.
- Add support/admin tooling for common failures.

### Deliverables

- Ops baseline for production.
- Security and support runbooks.

### Acceptance criteria

- The hosted service has enough visibility and control to operate safely under paying customers.

## Workstream 15: E2E Validation and Launch Readiness

### Goal

Validate the actual launch path, not just unit-level behavior.

### Critical E2E flows

- Cloud signup.
- Org creation.
- Billing activation.
- Desktop auth handoff.
- GitHub connection.
- Private repo enablement.
- Workspace provisioning.
- First task execution.
- Agent/runtime configuration.
- App restart and reconnect.
- Self-host deployment validation.

### Tasks

- Build test environments for cloud staging and self-host staging.
- Create launch checklists.
- Create smoke tests for every critical user journey.
- Verify support fallback paths for common failures.

### Deliverables

- Launch checklist.
- Automated and manual validation matrix.

### Acceptance criteria

- The team can prove the product works end to end for both cloud and self-host paths.

## Suggested v1 Scope

Recommended v1 scope:

- Foundry desktop app
- Foundry Cloud
- Self-hosted Foundry server
- GitHub only
- Coder only
- Stripe billing
- One solid runtime path
- Server-backed agent/runtime settings

Explicitly defer:

- GitLab
- multiple SCM integrations beyond GitHub
- broad runtime matrix optimization
- advanced enterprise policy surface beyond what is needed for secure launch

## Dependency Notes

### Must happen early

- Product boundary decision
- hosted auth model
- billing model
- GitHub integration model
- server-backed settings model for agents/runtime

### Blocks desktop UX completion

- cloud auth/session handoff
- org model
- server APIs for settings
- runtime/provider configuration endpoints

### Blocks public launch

- release automation
- signing/notarization
- OSS governance docs
- production ops baseline

## Risks

### 1. Partial rebrand confusion

If branding cleanup is deferred, the product will feel internally inconsistent and difficult to trust.

### 2. Operator-only setup leaking into customer UX

If admin workflows still depend on raw URLs, API keys, or config files, cloud onboarding will feel unfinished.

### 3. Settings authority split

If agent/runtime settings remain partly local and partly server-backed, multi-device behavior will become confusing quickly.

### 4. GitHub integration under-scoped

If GitHub is treated as “token accepted” rather than “customer-successful repo workflow,” launch will fail at the exact point where customers try to use the product.

### 5. Org-scoped workspace contention

If org-scoped workspaces are adopted without explicit isolation rules for repos, branches, and task worktrees, teams will see collisions, dirty state, and hard-to-debug failures.

### 6. Billing added too late

If billing is deferred until after onboarding and entitlements are built, entitlement wiring will be retrofitted badly.

## Recommended Milestone Breakdown

## Milestone 0: Decisions and Restructure

- Product boundary and architecture approved.
- Repo/service strategy approved.
- v1 scope locked.

## Milestone 1: Backend Product Core

- Foundry server established.
- Hosted auth/org model in place.
- GitHub integration basics working.
- Coder provisioning hardened enough for staging.

## Milestone 2: Desktop Product Path

- Cloud vs self-host onboarding shipped.
- Desktop auth handoff working.
- Settings IA redesigned.

## Milestone 3: Agents + Runtime

- Server-backed agent config shipped.
- Moltis/runtime configuration UI shipped.
- Validation and health flows shipped.

## Milestone 4: Commercial Readiness

- Billing and entitlements live.
- Org billing UI live.
- Cloud gating enforced.

## Milestone 5: Public Release Readiness

- OSS docs and governance docs merged.
- Desktop release automation working.
- Self-host docs and deployment examples published.
- Launch checklist passes.

## Immediate Next Actions

Recommended next actions after review:

1. Approve the v1 scope and product boundary decisions.
2. Decide on repo/service structure for `foundry-server`.
3. Write the initial domain model for orgs, billing, GitHub, workspaces, agents, and runtime settings.
4. Start the backend work needed for hosted auth, GitHub connection, and server-backed agent/runtime config.
5. Start the desktop onboarding/settings redesign in parallel, but only after the backend contracts are defined.

## Review Questions

- Do we want one repo or multiple repos for desktop, server, and cloud web?
- Do we want self-host to have near-feature parity with cloud at launch?
- Do we want org-scoped workspaces to be single long-lived workspaces, pooled workspaces, or another org-level topology?
