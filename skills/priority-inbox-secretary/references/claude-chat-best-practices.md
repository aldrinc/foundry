# Claude Chat Best Practices

Use Anthropic's native chat model, not an OpenAI-compatibility layer, for this
prototype.

Why:

- the Messages API is Claude's primary chat interface
- tool use is a first-class part of the message loop
- Files/document blocks fit the transcript and long-document requirement
- citations are available for grounded responses
- streaming is straightforward for a chat UI

Official references:

- Messages API overview:
  [docs.anthropic.com/en/api/messages](https://docs.anthropic.com/en/api/messages)
- Tool use overview:
  [docs.anthropic.com/en/docs/agents-and-tools/tool-use/overview](https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/overview)
- Streaming messages:
  [docs.anthropic.com/en/api/messages-streaming](https://docs.anthropic.com/en/api/messages-streaming)
- Files API:
  [docs.anthropic.com/en/docs/build-with-claude/files](https://docs.anthropic.com/en/docs/build-with-claude/files)
- Citations:
  [docs.anthropic.com/en/docs/build-with-claude/citations](https://docs.anthropic.com/en/docs/build-with-claude/citations)
- Prompt engineering overview:
  [docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/overview](https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/overview)

## Practical Rules

### 1. Treat the assistant as a stateless chat API

Anthropic's Messages API is stateless. Foundry must persist and replay the
relevant conversation turns on every request.

Implication:

- the server owns chat history
- the client renders streamed turns
- a refresh action can become a new user turn inside the same session

### 2. Keep tool use inside the same conversation

Claude requests tools with `tool_use`. Foundry executes the tool and returns a
`tool_result` in the next message payload.

Implication:

- do not collapse the tool loop into hidden server heuristics
- tool traces should map directly to the user-visible chat run

### 3. Use Files for large artifacts

Large transcripts, markdown plans, and reports should be uploaded through the
Files API and attached as `document` blocks.

Implication:

- keep the main prompt small
- attach a compact packet index so Claude can map file ids to thread context

### 4. Keep the system prompt tight

The system prompt should define role, constraints, and output discipline. Keep
business logic in tools and server contracts rather than bloating the prompt.

Implication:

- avoid giant instruction dumps
- give Claude clear task boundaries and concise tool descriptions

### 5. Stream the chat UI

Use Anthropic streaming for the secretary chat panel so the user sees progress
and short assistant answers without waiting for a full blocking run.

Implication:

- stream assistant text
- persist the final reply and the published snapshot after the turn completes

### 6. Separate chat text from structured product state

Claude's user-facing reply should stay short. The durable product state should
be a structured snapshot persisted by the runtime.

Implication:

- the assistant can say `I found 3 likely priorities and 2 unclear items`
- the actual card data should come from the structured snapshot with citations
