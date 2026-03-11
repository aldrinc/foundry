# Tool Contracts

## Purpose

These are the minimum tool capabilities the `priority-inbox-secretary` skill
expects.

The exact API surface can vary, but the capability set should stay stable.

## 1. Conversation Discovery

### `list_user_conversations`

Return the recent conversation candidates the user can access.

Expected output:

- `conversation_key`
- `kind` (`stream_topic`, `dm`, `group_dm`)
- `title`
- `stream_id` and `topic` where relevant
- `participant_ids` where relevant
- `last_message_id`
- `unread_count`

## 2. Thread Messages

### `get_conversation_messages`

Return the full recent thread transcript for a single conversation.

Expected output:

- `conversation_key`
- `messages[]`
- each message includes:
  - `message_id`
  - `sender_id`
  - `sender_name`
  - `timestamp`
  - `content_text`
  - `permalink`
  - `attachments[]`
  - `links[]`

## 3. Attachment and Transcript Text

### `get_attachment_text`

Fetch plain-text or markdown attachment contents for a referenced file.

Expected output:

- `attachment_id`
- `title`
- `mime_type`
- `text`
- `source_url`
- `citation_anchor`

### `get_transcript_text`

Fetch transcript text for a linked transcript file or transcript-backed asset.

Expected output:

- `transcript_id`
- `title`
- `text`
- `source_url`
- `citation_anchor`

## 4. Link Inspection

### `get_link_context`

Inspect a thread-linked URL and return a compact text summary for prompting.

Use for:

- markdown plans
- tickets
- PR links
- docs
- code review links

Expected output:

- `url`
- `title`
- `text`
- `citation_anchor`

## 5. Repo Change Context

### `get_recent_repo_changes`

Return recent code changes relevant to the user or to linked threads.

Expected output:

- `repo_id`
- `changes[]`
- each change includes:
  - `change_id`
  - `kind` (`commit`, `pr`, `diff`, `comment`)
  - `title`
  - `summary`
  - `source_url`
  - `files[]`
  - `citations[]`

### `get_change_file_excerpt`

Return a compact excerpt for a changed file.

Expected output:

- `path`
- `line_anchor`
- `excerpt`
- `source_url`

## 6. Existing Assistant State

### `get_priority_inbox_state`

Return prior open items and user feedback for the current user.

Expected output:

- `open_items[]`
- `feedback[]`
- `last_run`
- `recent_chat_turns[]`

## 7. Persistence

### `publish_priority_snapshot`

Persist one structured secretary snapshot for the current turn.

Expected payload:

- `priorities[]`
- `unclear[]`
- `run_notes`
- citation ids and packet ids for every item

### `save_priority_inbox_run`

Persist one structured run result.

Expected payload:

- prompt version
- model
- packet index
- raw structured response
- generated items

### `save_priority_inbox_feedback`

Persist user actions.

Expected payload:

- `item_key`
- `action`
- optional note

## 8. Tool Trace Logging

### `record_tool_trace`

Persist tool-call trace metadata for observability.

Expected payload:

- run id
- tool name
- args summary
- result summary
- status
- duration

## Notes

- The first implementation should keep these tools server-side in Foundry-core.
- Tools the model actively uses should be exposed as Claude tools through the
  native Messages API.
- Runtime persistence that does not require model choice can stay outside the
  tool surface.
- The skill should not call the database directly.
- The client should not execute these tools.
