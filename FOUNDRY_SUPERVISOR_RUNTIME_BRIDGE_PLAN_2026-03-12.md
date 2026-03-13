# Foundry Supervisor Runtime Bridge Plan

## Goal

Close the gap between the new Foundry supervisor UI and the current orchestrator/backend contract by making the UI consume DeerFlow-style runtime state as the authoritative source, while preserving the new timeline components for structured trace and live progress.

This is a revision of the current plan, not a replacement of the work already done.

## Why This Revision Exists

The current frontend work is good, but it assumes that richer timeline events are the primary bridge between backend and UI.

The DeerFlow reference points in a different direction:

- runtime state is authoritative
- middleware composes a normalized session/runtime view before the model and UI make decisions
- clarification and approval are interrupt states, not just chat text
- uploads, memory, checkpoints, repo attachment state, and execution readiness are explicit state, not inferred from messages

Meridian already adopted that shape locally:

- `infra/hetzner-apps/meridian-coder-orchestrator/supervisor_runtime/`
- `infra/hetzner-apps/meridian-coder-orchestrator/DEERFLOW_SOURCE_MAP.md`
- `infra/hetzner-apps/meridian-coder-orchestrator/validate_supervisor_conversational_flow.py`

The revision therefore is:

- keep the new timeline work
- make runtime snapshot state the first-class bridge
- use timeline events as incremental UX, not as the only source of truth

## DeerFlow Reference: What Matters

What should be copied in spirit:

- middleware-composed runtime state
- explicit interrupt handling for clarification and approval
- explicit sandbox, uploads, memory, checkpoints, and repo attachment state
- prompt contract that treats runtime and capabilities as authoritative

What should not be copied directly:

- LangGraph persistence/checkpointer architecture as the primary product store
- DeerFlow's thread store replacing Meridian sessions, plans, tasks, and executor

Meridian was correct to keep:

- `store.py` as the DB-backed authority
- `executor.py` as the task lifecycle authority
- `app.py` as the supervisor control layer

## Target Architecture

The target bridge should have two layers.

### 1. Authoritative Runtime Layer

Primary source:

- `GET /json/foundry/topics/{scope}/supervisor/session`

Authoritative data to expose to the desktop app:

- active plan revision
- filtered plan revision
- visible tasks
- task counts
- runtime phase
- dispatch blockers
- approval state
- clarification state
- repo attachment state
- worker backend readiness
- completion follow-up state
- observed artifacts
- normalized runtime state payload

Secondary source:

- `GET /json/foundry/topics/{scope}/supervisor/runtime`

Use this for:

- explicit runtime inspector surfaces
- deep recovery/debug hydration
- parity validation against the server web UI

### 2. Incremental Timeline Layer

Primary source:

- supervisor SSE stream

Timeline events should:

- explain what happened
- patch existing cards
- improve live readability
- not be required to reconstruct the entire state model

## New Frontend Contract

Phase 1 should be mostly type-surface and state-store work, because the orchestrator already returns richer data than the desktop bindings currently expose.

### Task Summary Contract

Extend the current desktop `SupervisorTaskSummary` to include:

- `task_count`
- `counts`
- `all_task_count`
- `all_counts`
- `completion_follow_up_required`
- `completion_missing_evidence`
- `phase`
- `runtime_state`
- `tasks`

### Runtime Projection Contract

Define a typed projection for the current orchestrator runtime payload:

- `phase`
- `phase_reason`
- `approval_required`
- `clarification_required`
- `execution_requested`
- `dispatch_prerequisites_ready`
- `dispatch_blockers`
- `completion_follow_up_required`
- `completion_missing_evidence`
- `observed_artifacts`
- `repo_attachment`
- `worker_backend_ready`
- `active_plan_revision_id`
- `contract`
- `runtime_state`

Do not over-normalize the nested `runtime_state` object in phase 1. Preserve the raw shape first, then tighten it after the UI is using it.

## Reuse vs Refactor Matrix

### Reuse As-Is

| File | Current value | Action |
|---|---|---|
| `foundry/packages/app/src/components/supervisor/event-renderers.tsx` | `PlanSection`, `TaskGroupSection`, inline task controls, clarification reply, and task status rendering are all aligned with the desired structured trace UI. | Keep. Reuse as the timeline renderer for plan/job/task trace. |
| `foundry/packages/app/src/context/supervisor.tsx` | `planIndex`, `jobIndex`, `taskIndex`, `plan_update`, `task_update`, `content_delta`, `controlTask`, and `replyToClarification` already form a strong event reducer base. | Keep the reducer model and extend it with runtime summary state. |
| `foundry/packages/app/src/components/supervisor/supervisor-panel.tsx` | The current shell composition is correct: session rail, header, delegate roster, timeline, composer. | Keep the layout skeleton. Insert runtime-state UI into this shell rather than redesigning the panel. |
| `foundry/packages/app/src/components/supervisor/supervisor-timeline.tsx` | Auto-scroll, reconnect indicator, and streaming affordances are useful independent of the data model. | Keep. Use it to render the structured trace after runtime summary surfaces. |
| `foundry/packages/app/src/components/supervisor/supervisor-composer.tsx` | Send flow, uploads, drag/drop, and text entry are compatible with DeerFlow-style runtime context. | Keep. Only adjust composer affordances when runtime interrupts need explicit call-to-action treatment. |
| `foundry/packages/app/src/components/supervisor/supervisor-session-list.tsx` | Session switching and draft/new-session affordances are already correct. | Keep. Later enrich rows with runtime phase or blocker badges. |
| `foundry/packages/app/src/components/supervisor/supervisor-delegate-roster.tsx` | Delegate visibility still makes sense in the runtime-first model. | Keep as-is. |
| `foundry/packages/app/src/components/supervisor/supervisor-header.tsx` | Header shell is correct. | Keep the component, but enrich the data shown. |
| `foundry/packages/desktop/src/styles.css` | `supervisor-spin` and existing supervisor animation utilities remain valid. | Keep. |
| `foundry/services/foundry-core/app/zerver/views/foundry_tasks.py` | The Foundry Core proxy already forwards `task_summary` and the runtime endpoint without collapsing the backend payload. | Keep. This is not the bottleneck. |
| `infra/hetzner-apps/meridian-coder-orchestrator/supervisor_runtime/*` | DeerFlow-style runtime composition is already present. | Keep as backend authority for runtime projection. |

### Extend, Do Not Rewrite

| File | Current gap | Action |
|---|---|---|
| `foundry/packages/desktop/src-tauri/src/zulip/supervisor_types.rs` | `SupervisorTaskSummary` only exposes plan ids and tasks, dropping `phase`, `counts`, `completion_follow_up_required`, and `runtime_state`. | Extend the DTOs and regenerate bindings. |
| `foundry/packages/desktop/src/bindings.ts` | Generated type surface currently hides the richer task summary/runtime projection. | Regenerate after Rust DTO extension. |
| `foundry/packages/app/src/context/supervisor.tsx` | Store currently treats `tasks` as the only summary layer and timeline events as the richer state source. | Add runtime summary state and merge logic while preserving existing event reducers. |
| `foundry/packages/app/src/components/supervisor/supervisor-header.tsx` | Header only shows connection status and title. | Extend to show runtime phase, repo attachment status, or active blocker summary. |
| `foundry/packages/app/src/components/supervisor/supervisor-panel.tsx` | No runtime-state strip or interrupt card exists yet. | Add a runtime summary section above the timeline. |
| `foundry/packages/app/src/components/supervisor/event-renderers.tsx` | `content_delta` assumes a target message already exists. | Add a safe placeholder creation path or enforce backend emission of a parent assistant message first. |

### Refactor or De-Emphasize

| Item | Reason | Action |
|---|---|---|
| Old `TaskDashboard` pattern | The old dashboard was a second summary surface detached from runtime-state semantics. | Keep it removed. Replace it with a runtime summary/interrupt surface, not a restored legacy dashboard. |
| Timeline as the sole truth source | This was the main UX failure mode. It forces the UI to infer execution state from chat-like output. | Refactor the mental model so timeline is trace, not authority. |
| Assistant narrative as the only blocker explanation | DeerFlow and Meridian runtime both treat clarification, approval, and repo binding as explicit state. | Replace with explicit runtime cards and CTA-driven UI. |
| Heuristic parsing approaches from older server web UI | Those patterns infer task state from text and are weaker than the current runtime projection. | Do not carry these patterns into the desktop app. |

## File-Specific Assessment Of The Verified UI Work

### `event-renderers.tsx`

Can be utilized:

- `PlanSection`
- `TaskGroupSection`
- task-level controls
- clarification reply UI
- result, error, and activity displays

Needs refactor:

- make timeline rows clearly secondary to runtime summary
- handle `content_delta` safely if the backend streams before emitting a parent message
- optionally add renderers for runtime review or follow-up events if they remain in the timeline

### `supervisor.tsx`

Can be utilized:

- event indexing
- patch-in-place mutation model
- optimistic user echo
- SSE connect/disconnect handling
- polling fallback
- task controls and clarification reply commands

Needs refactor:

- add `runtimeSummary` or equivalent typed state
- merge `task_summary.phase`, counts, follow-up state, and `runtime_state`
- derive UI booleans like `approvalRequired`, `clarificationRequired`, `dispatchReady`, `repoAttachmentMissing` from authoritative runtime projection, not from inferred timeline state

### `supervisor-panel.tsx`

Can be utilized:

- overall composition
- warning banner location
- timeline/composer structure

Needs refactor:

- insert a runtime summary layer between roster and timeline
- add interrupt CTA surfaces for approval, clarification, repo attachment, and completion follow-up

### `styles.css`

Can be utilized:

- `supervisor-spin`
- current supervisor utility styles

Needs refactor:

- add styles for runtime phase badges
- add styles for interrupt cards and contract state chips

## Recommended New UI Sections

Add these above the timeline:

1. `SupervisorRuntimeStrip`
   - phase
   - phase reason
   - active plan id
   - repo attachment status
   - worker backend readiness

2. `SupervisorInterruptCard`
   - approval required
   - clarification required
   - repo missing or low-confidence
   - completion follow-up required

3. `SupervisorEvidenceSummary`
   - observed artifacts
   - preview presence
   - branch or PR evidence
   - missing evidence badges

The timeline then becomes:

- plan draft and plan acceptance
- dispatch acceptance
- task/job progress
- tool traces
- assistant narrative

## Delivery Phases

### Phase 1: Bind The Existing Runtime Contract

Goal:

- consume what the orchestrator already returns

Tasks:

- extend Rust supervisor DTOs
- regenerate desktop bindings
- add runtime summary state to `supervisor.tsx`
- render runtime strip and interrupt cards

Expected result:

- large UX improvement without waiting for new backend event types

### Phase 2: Normalize Incremental Event Semantics

Goal:

- make the timeline cleaner and safer

Tasks:

- ensure backend emits explicit parent assistant messages before `content_delta`, or synthesize placeholders in the frontend
- stabilize `plan`, `plan_update`, `job_started`, and `task_update` payloads
- stop relying on assistant prose to explain runtime blockers that already exist as state

Expected result:

- better live updates and less brittle timeline mutation

### Phase 3: Promote Runtime Interrupts To First-Class Actions

Goal:

- align clarification and approval UX with DeerFlow-style interrupts

Tasks:

- surface approval-required CTA
- surface clarification-required CTA
- surface repo-attachment-required CTA
- surface completion-follow-up-required CTA

Expected result:

- execution blockers are actionable without reading narrative messages

### Phase 4: Hardening And Parity Cleanup

Goal:

- remove duplicate interpretations of supervisor state

Tasks:

- keep server web UI and desktop UI aligned on runtime projection semantics
- retire any remaining heuristic text-parsing assumptions
- ensure reconnect and session-switch paths fully rehydrate runtime state

## Validation Gates

The revised bridge is only ready when these flows work in a dev deployment:

1. Open supervisor for a topic with no plan and see `idle` or planning-ready runtime state.
2. Draft a plan and see runtime phase plus timeline plan card stay in sync.
3. Approve execution and see dispatch readiness and repo attachment state update correctly.
4. Watch live worker progress with runtime phase and timeline both updating.
5. Trigger clarification and resolve it from explicit UI controls.
6. Pause, resume, and cancel a task from the timeline.
7. Reconnect after SSE loss and rehydrate the same runtime phase and task state from polling.
8. Switch sessions and see the panel fully replace both runtime summary and timeline.
9. Reach terminal completion with missing evidence and surface completion follow-up clearly.

## Immediate Recommendation

Do not wait for a brand-new backend event system before shipping the next iteration.

The immediate path is:

- extend bindings to expose the runtime fields that already exist
- add runtime summary and interrupt UI above the timeline
- keep the new timeline components as the structured trace layer

That gives Foundry the DeerFlow-aligned behavior sooner, while preserving the supervisor timeline work already completed.
