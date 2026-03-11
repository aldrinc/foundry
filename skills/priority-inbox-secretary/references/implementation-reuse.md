# Implementation Reuse

## Reuse from `mos/backend`

The Foundry prototype should reuse the implementation patterns in:

- [`app/services/claude_files.py`](/Users/aldrinclement/Documents/programming/marketi/mos/backend/app/services/claude_files.py)
- [`app/agent/runtime.py`](/Users/aldrinclement/Documents/programming/marketi/mos/backend/app/agent/runtime.py)
- [`app/agent/types.py`](/Users/aldrinclement/Documents/programming/marketi/mos/backend/app/agent/types.py)
- [`app/routers/claude.py`](/Users/aldrinclement/Documents/programming/marketi/mos/backend/app/routers/claude.py)

## What to Reuse

### 0. Native Claude chat transport

From `routers/claude.py`:

- native Anthropic `messages.stream(...)`
- SSE event framing for a chat UI
- direct handling of assistant text deltas
- request/model/usage tracing

Foundry should reuse this pattern for the secretary chat endpoint instead of
putting Claude behind an OpenAI-compatibility wrapper.

### 1. Claude Files upload and dedup

From `claude_files.py`:

- upload file bytes to Anthropic Files API
- sanitize filenames
- deduplicate by content hash
- persist file ids for reuse
- convert stored file ids into Claude `document` blocks

Foundry should use the same pattern for:

- transcript files
- long markdown plans
- long text attachments
- large linked-doc extracts

### 2. Claude snapshot validation path

From `claude_files.py`:

- strict schema validation utilities for Claude Messages API results
- additionalProperties normalization
- retry handling
- request id capture
- usage capture
- JSON extraction/repair for minor wrapper noise

Foundry should reuse this for validating `publish_priority_snapshot` payloads
rather than inventing a second result parser.

### 3. Agent run and tool trace model

From `agent/runtime.py` and `agent/types.py`:

- explicit run lifecycle
- per-tool trace rows
- compact tool results for model context
- UI-friendly structured result payloads

Foundry's priority inbox skill should persist:

- run id
- tool calls
- results
- failures

This is the right traceability baseline for the prototype.

### 4. Context-file browsing pattern

From `routers/claude.py`:

- list reusable context files for a workspace
- materialize Claude document blocks from stored records

Foundry should adapt this pattern for the current user/org context instead of a
marketing workspace.

## What Not to Copy Directly

- marketing-specific personas
- funnel/product/client naming
- campaign-oriented workspace semantics

The reuse target is:

- native Claude chat transport
- Claude Files support
- snapshot validation
- agent run observability

not the MOS business model.
