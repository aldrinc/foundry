#!/usr/bin/env python3
from __future__ import annotations

import shlex
from dataclasses import dataclass
from typing import Any, Dict, List, Optional


INTENT_BY_COMMAND = {
    "cancel": "cancel",
    "stop": "cancel",
    "abort": "cancel",
    "status": "ask_status",
    "progress": "ask_status",
    "retry": "retry",
    "rerun": "retry",
    "approve": "approve",
    "revise": "revise",
    "pause": "pause",
    "resume": "resume",
    "clarify": "needs_clarification",
    "needs_clarification": "needs_clarification",
    "resolve": "resolve_clarification",
}


@dataclass(frozen=True)
class ParsedTaskCommand:
    intent: str
    argument: str
    scope: str
    explicit: bool
    raw_command: str

    def to_dict(self) -> Dict[str, Any]:
        return {
            "intent": self.intent,
            "argument": self.argument,
            "scope": self.scope,
            "explicit": self.explicit,
            "raw_command": self.raw_command,
        }


def _tokenize(text: str) -> List[str]:
    try:
        return shlex.split(text)
    except Exception:
        return [item for item in text.strip().split(" ") if item]


def parse_task_command(message: str) -> Optional[ParsedTaskCommand]:
    text = str(message or "").strip()
    if not text:
        return None

    if not text.startswith("/task"):
        return None

    tokens = _tokenize(text)
    if len(tokens) < 2:
        return ParsedTaskCommand(
            intent="unclear",
            argument="",
            scope="task",
            explicit=True,
            raw_command=text,
        )

    cmd = str(tokens[1] or "").strip().lower()
    intent = INTENT_BY_COMMAND.get(cmd, "unclear")

    scope = "task"
    args: List[str] = []
    index = 2
    while index < len(tokens):
        token = tokens[index]
        if token == "--scope" and index + 1 < len(tokens):
            candidate = str(tokens[index + 1] or "").strip().lower()
            if candidate in {"task", "topic"}:
                scope = candidate
            index += 2
            continue
        args.append(token)
        index += 1

    return ParsedTaskCommand(
        intent=intent,
        argument=" ".join(args).strip(),
        scope=scope,
        explicit=True,
        raw_command=text,
    )
