# Source Packets

## Goal

Source packets are the bounded context objects passed into the skill.

The packet builder is deterministic. The skill decides what matters after the
packets are built.

## Packet Shape

Each packet should contain:

- `packet_id`
- `conversation_key`
- `source_type`
- `title`
- `text`
- `citations`

Optional fields:

- `message_ids`
- `link_urls`
- `repo_change_ids`
- `attachment_ids`
- `file_id` for Claude Files

## Source Types

Recommended types:

- `stream_topic`
- `dm`
- `group_dm`
- `transcript`
- `attachment_text`
- `linked_doc`
- `repo_change`

## Packet Construction Rules

### Message packets

- include recent full thread text, not only topic name or latest message
- preserve sender and time in citations
- strip UI-only noise and HTML wrappers

### Transcript packets

- preserve raw transcript text if it is readable plain text
- keep citation anchors to transcript source URL or message permalink
- include compact metadata such as meeting title or recording name

### File packets

- include markdown and plain text directly
- skip binary files in v1
- if a file is large, prefer Claude Files and attach only a compact index entry

### Repo change packets

- include title, summary, and small excerpts
- keep links back to the original change
- use compact text, not full diff dumps by default

## Size Guidance

Keep the inline packet set bounded.

Suggested approach:

- keep small packets inline
- upload large packets to Claude Files
- always include a packet index with packet ids, titles, and source types

## Citation Rules

Every packet must include citations that are stable and clickable.

Each citation should contain:

- `citation_id`
- `source_url`
- `anchor`
- `excerpt`
- `captured_at`

The model should never output an item without pointing back to these ids.
