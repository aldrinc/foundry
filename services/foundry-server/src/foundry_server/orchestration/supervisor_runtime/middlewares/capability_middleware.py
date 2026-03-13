"""Capability projection middleware for topic runtime state."""

from __future__ import annotations

from typing import Any

from ..thread_state import TopicRuntimeState


class CapabilityMiddleware:
    name = "capabilities"

    def apply(self, state: TopicRuntimeState) -> None:
        payload = state.get("input") if isinstance(state.get("input"), dict) else {}
        worker_backends = [
            item for item in (payload.get("worker_backends") or []) if isinstance(item, dict)
        ]
        integration_tools = [
            item for item in (payload.get("integration_tools") or []) if isinstance(item, dict)
        ]
        mcp_tools = [item for item in (payload.get("mcp_tools") or []) if isinstance(item, dict)]
        repo_create_capabilities: list[str] = []
        for item in integration_tools:
            tools = [str(tool).strip() for tool in (item.get("declared_capabilities") or []) if str(tool).strip()]
            if any(tool.endswith("repo_create") or "repo_create" in tool for tool in tools):
                repo_create_capabilities.append(str(item.get("integration") or "").strip())
        for item in mcp_tools:
            tool_name = str(item.get("tool") or item.get("id") or "").strip()
            if "repo" in tool_name.lower() and "create" in tool_name.lower():
                repo_create_capabilities.append(tool_name)
        state["capabilities"] = {
            "worker_backends": worker_backends,
            "integration_tools": integration_tools,
            "mcp_tools": mcp_tools,
            "repo_create_available": bool(repo_create_capabilities),
            "repo_create_capabilities": sorted(set(repo_create_capabilities)),
            "execution_available": any(bool(item.get("supports_execution")) for item in worker_backends),
        }
