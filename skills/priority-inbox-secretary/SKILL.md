---
name: priority-inbox-secretary
description: Use this skill when building or operating Foundry's priority inbox assistant. It defines a chat-first Claude secretary that reviews a user's accessible threads, transcripts, files, links, and recent code changes through tools, uploads substantial context through Claude Files, and maintains concise priority and unclear lists with citations and traceable run state.
---

# Priority Inbox Secretary

## Goal

Build Foundry's inbox assistant as a real skill-driven secretary for one user.

The skill's job is to:

- review the work context the user can actually access
- pull the material it needs through tools
- surface likely important items
- separate uncertain items into an explicit `unclear` list
- cite every meaningful claim
- persist enough memory for the next run

This skill is the prototype baseline. It is not a heuristic layer and not a UI
mock.

## Non-Negotiables

- Do not use heuristics to decide what matters.
- Do not let the client rank, summarize, or infer ownership.
- Do not produce long summaries.
- Do not hide uncertainty.
- Do not emit an item without citations.
- Do not depend on a local file-export workflow.
- Do not model this as a one-shot summarize endpoint.
- Do not route Claude through an OpenAI-compatibility path for this prototype.

The only deterministic logic in the prototype should be:

- permission-gated source collection
- chat/session persistence
- tool execution
- packet construction and file upload
- file upload/dedup
- snapshot validation
- persistence and streaming transport

The actual prioritization judgment comes from Claude operating inside a
server-side chat loop.

## Runtime Shape

1. Start or resume a secretary chat session for one user.
2. Give Claude the current user turn, compact prior state, and available tools.
3. Let Claude gather what it needs through iterative tool use.
4. Upload substantial source material to Claude Files when appropriate.
5. Require Claude to publish a compact `priority snapshot` before ending a
   review turn.
6. Persist chat turns, snapshot state, citations, tool traces, and user
   feedback.
7. Stream the assistant reply and updated inbox state to the UI.

Keep the client thin. The server is responsible for:

- ACL enforcement
- chat/session replay
- tool execution
- native Anthropic Messages API calls
- state persistence
- SSE streaming
- traceability

## Chat Interface

The primary product surface should be a chat with the secretary, not a static
JSON result.

The inbox should show:

- a compact assistant chat panel
- the current `Likely important` list
- the current `Unclear` list
- clickable citations on every surfaced item

Expected behavior:

- when Inbox opens, Foundry can trigger a review turn such as `Review my current
  work and surface what matters`
- the assistant streams back a short reply while it gathers and analyzes context
- the assistant may ask brief clarifying questions in chat when the evidence is
  genuinely ambiguous
- the card lists are derived from the latest published snapshot in that same
  conversation

The chat loop should use Claude's native Messages API semantics:

- the API is stateless, so Foundry must replay the relevant conversation turns
  on each request
- tool calls and tool results stay inside the same conversation
- the UI should stream assistant output rather than waiting for a final blob

See [`references/claude-chat-best-practices.md`](./references/claude-chat-best-practices.md).

## Required Tools

The skill should have tool access for the following capabilities.

### Messaging and thread context

- list recent conversations for the user
- fetch full thread/topic messages
- fetch direct-message conversation messages
- fetch recent followed topics and active threads

### Transcript and attachment context

- inspect message attachments and linked files
- fetch transcript text when the file is plain text or markdown
- fetch text attachment contents when supported
- extract link metadata and titles

### Code and change context

- review recent codebase changes relevant to the user or linked threads
- inspect changed files and commit/PR summaries
- identify if a thread-linked code change appears to close or change an item

### Assistant state

- read prior open items and user feedback
- read the recent secretary chat session state
- persist current run output
- publish the latest priority snapshot
- persist citations
- persist user actions such as `done`, `waiting`, `not_mine`, `reopen`
- record tool calls for traceability

The first implementation of the tools is described in
[`references/tool-contracts.md`](./references/tool-contracts.md).

## Source Packet Rules

The skill should not see a raw firehose, but it also should not be limited to a
single prebuilt packet list.

The tool layer should support iterative context gathering:

- start with recent conversation candidates and compact packet summaries
- let Claude pull full threads, transcripts, files, links, and repo changes
  only when needed
- promote large or important artifacts into Claude Files when inline context
  would become unstable

The runtime may prebuild bounded packets from:

- unread conversations
- recent home-view conversations
- recent DMs
- transcript files linked in recent conversations
- text attachments and markdown files linked in recent conversations
- recent repo changes or code links tied to those conversations

Each packet should contain:

- stable `packet_id`
- `conversation_key`
- source type
- title
- compact text body
- citation list

The runtime chooses what is available to inspect. Claude decides what matters
after reading the packets and tool results.

See [`references/source-packets.md`](./references/source-packets.md).

## Claude Files Rules

Use Claude Files for substantial context.

Upload a packet to Claude Files when any of these are true:

- the packet is a natural standalone document
- the packet is large enough that inline text would bloat the prompt
- the run needs several large packets and the prompt would become unstable

Natural standalone documents include:

- meeting transcripts
- markdown plans
- text reports
- large diff summaries
- generated notes with their own title and body

Small packets can stay inline.

When using Claude Files:

- deduplicate by content hash
- reuse prior uploaded file ids
- attach document blocks alongside a compact textual index
- keep the prompt aware of which file corresponds to which packet
- preserve citation anchors so the final snapshot can point back to the source

Implementation reuse is documented in
[`references/implementation-reuse.md`](./references/implementation-reuse.md).

## Conversation Contract

The skill should use Claude's native Messages API as an ongoing conversation.

Each request should send:

- the system prompt from the skill
- recent secretary conversation turns
- the current user turn
- a compact summary of prior open-item state and user feedback
- the current source packet index
- inline packet content and tool results
- document blocks for uploaded packets
- the available tool definitions

Claude may respond with:

- plain assistant text for the chat UI
- `tool_use` blocks requesting more context
- a structured `publish_priority_snapshot` tool call containing the current
  inbox state

The `publish_priority_snapshot` payload must contain:

- `priorities`
- `unclear`
- compact run notes such as `needs_follow_up_question`

Each returned item must include:

- stable external key
- short title
- short summary
- short why
- status
- confidence
- packet ids
- citation ids

The concrete prompt, chat loop, and snapshot schema live in
[`references/prompt-contract.md`](./references/prompt-contract.md).

## Output Rules

The skill's output should optimize for speed of use.

- Titles should be short and task-first.
- Summaries should usually be one sentence and never more than two.
- `Why` should explain the basis of the item, not repeat the summary.
- Weak ownership or ambiguous evidence goes to `unclear`.
- If multiple items come from the same thread, merge them when possible.
- The assistant's chat reply should be shorter than the snapshot it just
  published.

The output must help the user read less, not more.

## Memory Rules

Keep prototype memory minimal.

Persist only:

- secretary chat sessions and turns
- runs
- items
- citations
- user feedback
- tool traces

Do not add embeddings or a generalized memory platform in the first pass.

## Traceability Rules

Every run should be inspectable without exposing chain-of-thought.

Persist:

- conversation id / session id
- prompt version
- model
- packet ids used
- assistant replies that were shown to the user
- snapshot payloads
- tool call log

Show in the product:

- why the item surfaced
- its citations
- whether it is likely important or unclear
- the latest short assistant reply

## Implementation Guidance

Use this skill with:

- server-side execution in Foundry-core
- native Anthropic Messages API calls
- Claude tool use
- SSE or equivalent streamed chat transport
- Claude Files for large context
- run and tool-call persistence similar to the `mos/backend` agent runtime

Read these references before implementing:

- [`references/claude-chat-best-practices.md`](./references/claude-chat-best-practices.md)
- [`references/tool-contracts.md`](./references/tool-contracts.md)
- [`references/prompt-contract.md`](./references/prompt-contract.md)
- [`references/source-packets.md`](./references/source-packets.md)
- [`references/implementation-reuse.md`](./references/implementation-reuse.md)
