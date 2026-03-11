# Prompt Contract

This skill should run as a Claude chat session using the native Messages API.

Do not model the secretary as a single request/response blob. The structured
priority state should be emitted through a tool call inside the conversation.

## System Prompt

```text
You are Foundry's priority inbox secretary for one specific user.

Work like a strong executive secretary:
- review the user's real work context
- pull more context with tools when needed
- surface only what appears important
- keep wording tight
- separate uncertain items into an explicit unclear list
- cite every surfaced claim

Rules:
1. Do not invent details that are not supported by tool results or attached documents.
2. Prefer explicit asks, blockers, decisions, follow-ups, and likely next steps.
3. If ownership or importance is unclear, keep the item in unclear rather than overstating it.
4. Keep chat replies short. The card snapshot is the main durable output.
5. Before ending a review turn, call publish_priority_snapshot if the inbox state changed.
6. Every snapshot item must include packet ids and citation ids.
7. If earlier feedback says an item is done, waiting, or not mine, take that into account.
8. Ask a brief clarifying question only when the ambiguity materially changes the outcome.
```

## Conversation Envelope

Each request should send:

- the system prompt
- recent secretary conversation history
- the current user turn
- available Claude tool definitions
- compact prior inbox state
- compact source packet index
- inline packets
- document blocks for uploaded Claude Files

Suggested user turn on inbox refresh:

```text
Review my current work and update my priority inbox.

User:
- name: {user_name}
- email: {user_email}
- current_time: {iso_timestamp}

Prior inbox state:
{existing_state_json}

Source packet index:
{source_packet_index_json}

Inline packets:
{inline_source_packets_json}

Attached Claude files:
{claude_file_index_json}
```

## Tool Loop

Claude may take multiple steps in one turn:

1. inspect the current packet index
2. call tools to pull full threads, transcripts, links, files, or repo changes
3. read tool results and attached documents
4. call `publish_priority_snapshot`
5. send a short assistant reply for the user

Foundry should feed tool results back as `tool_result` messages in the same
conversation.

## Required Snapshot Tool

Expose a tool named `publish_priority_snapshot`.

Expected input shape:

```json
{
  "priorities": [
    {
      "external_key": "string",
      "conversation_key": "string",
      "title": "string",
      "summary": "string",
      "why": "string",
      "status": "needs_action",
      "confidence": "high",
      "source_packet_ids": ["packet_1"],
      "citation_ids": ["citation_1"]
    }
  ],
  "unclear": [
    {
      "external_key": "string",
      "conversation_key": "string",
      "title": "string",
      "summary": "string",
      "why": "string",
      "status": "unclear",
      "confidence": "low",
      "source_packet_ids": ["packet_9"],
      "citation_ids": ["citation_12"]
    }
  ],
  "run_notes": {
    "needs_follow_up_question": false,
    "follow_up_question": null
  }
}
```

## Snapshot Expectations

- `title` should be short and task-first.
- `summary` should usually be one sentence and never more than two.
- `why` should state the evidence basis for surfacing the item.
- `confidence` should be `high`, `medium`, or `low`.
- `status` in `priorities` should be one of:
  - `needs_action`
  - `waiting`
  - `watch`
- `status` in `unclear` must be `unclear`.
- `run_notes.follow_up_question` should only be used when the ambiguity is worth
  interrupting the user about.

## Assistant Reply Expectations

After publishing the snapshot, Claude should send a short user-facing reply.

Good pattern:

- one sentence on the outcome
- one sentence on the most important next action or uncertainty

Bad pattern:

- repeating every card in prose
- long transcript summaries
- dumping raw evidence into the chat reply

## Packet Usage Rules

- Use inline packets for small text.
- Use Claude Files for long transcripts, long markdown plans, and larger reports.
- Always include a compact packet index even when files are attached, so Claude
  can map file titles and tool results back to packet ids.

## Failure Policy

If Claude fails to publish a valid snapshot:

1. retry the turn once with a validation error message
2. keep the schema unchanged
3. do not silently coerce the meaning of the output

Minor JSON formatting repair is acceptable. Meaning repair is not.
