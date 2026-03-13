#!/usr/bin/env python3
import json
import logging
import time
from datetime import datetime
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

import requests


class CoderAPIError(RuntimeError):
    pass


class CoderClient:
    def __init__(
        self,
        *,
        base_url: str,
        api_token: str,
        verify_tls: bool = True,
        timeout_seconds: float = 25,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_token = api_token.strip()
        self.timeout_seconds = float(timeout_seconds)
        self.http = requests.Session()
        self.http.verify = verify_tls
        self._deployment_config_cache: Optional[Dict[str, Any]] = None

    def _headers(self) -> Dict[str, str]:
        headers = {
            "Content-Type": "application/json",
        }
        if self.api_token:
            # Coder accepts session token header; include Bearer for compatibility.
            headers["Coder-Session-Token"] = self.api_token
            headers["Authorization"] = f"Bearer {self.api_token}"
        return headers

    def _request(
        self,
        method: str,
        path: str,
        *,
        params: Optional[Dict[str, Any]] = None,
        body: Optional[Dict[str, Any]] = None,
        expected: Optional[List[int]] = None,
    ) -> requests.Response:
        url = f"{self.base_url}{path}"
        response = self.http.request(
            method=method,
            url=url,
            headers=self._headers(),
            params=params,
            data=json.dumps(body) if body is not None else None,
            timeout=self.timeout_seconds,
        )
        if expected is not None and response.status_code not in expected:
            message = response.text[:4000]
            raise CoderAPIError(
                f"Coder API {method} {path} failed: {response.status_code} {message}"
            )
        return response

    @staticmethod
    def _json(response: requests.Response) -> Dict[str, Any]:
        try:
            data = response.json()
        except Exception as exc:
            raise CoderAPIError(f"Coder API returned invalid JSON: {exc}") from exc
        if not isinstance(data, dict):
            raise CoderAPIError("Coder API returned non-object JSON response")
        return data

    def get_workspace(self, workspace_id: str) -> Dict[str, Any]:
        response = self._request(
            "GET",
            f"/api/v2/workspaces/{workspace_id}",
            expected=[200],
        )
        data = self._json(response)
        return data.get("workspace") if isinstance(data.get("workspace"), dict) else data

    def list_workspaces(self, *, owner: Optional[str] = None, query: Optional[str] = None) -> List[Dict[str, Any]]:
        params: Dict[str, Any] = {}
        if owner:
            params["owner"] = owner
        if query:
            params["q"] = query
        response = self._request(
            "GET",
            "/api/v2/workspaces",
            params=params or None,
            expected=[200],
        )
        data = self._json(response)
        values = data.get("workspaces")
        if isinstance(values, list):
            return [item for item in values if isinstance(item, dict)]
        if isinstance(data, list):
            return [item for item in data if isinstance(item, dict)]
        return []

    def find_workspace_by_name(self, *, owner: str, workspace_name: str) -> Optional[Dict[str, Any]]:
        candidates = self.list_workspaces(owner=owner, query=workspace_name)
        needle = workspace_name.strip().lower()
        for item in candidates:
            if str(item.get("name") or "").strip().lower() == needle:
                return item
        return None

    def create_workspace(
        self,
        *,
        owner: str,
        workspace_name: str,
        template_id: str,
        repo_url: Optional[str] = None,
        parameter_values: Optional[Dict[str, str]] = None,
        template_version_id: Optional[str] = None,
        create_overrides: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        params = parameter_values or {}
        payload: Dict[str, Any] = {
            "name": workspace_name,
            "template_id": template_id,
            "parameter_values": params,
            "rich_parameter_values": [
                {"name": key, "value": value} for key, value in params.items()
            ],
        }
        if repo_url:
            payload.setdefault("parameter_values", {})["repo_url"] = repo_url
            payload.setdefault("rich_parameter_values", []).append(
                {"name": "repo_url", "value": repo_url}
            )
        if template_version_id:
            payload["template_version_id"] = template_version_id
        if create_overrides:
            payload.update(create_overrides)

        response = self._request(
            "POST",
            f"/api/v2/users/{owner}/workspaces",
            body=payload,
            expected=[200, 201, 202, 409],
        )

        if response.status_code == 409:
            existing = self.find_workspace_by_name(owner=owner, workspace_name=workspace_name)
            if existing is None:
                raise CoderAPIError(
                    f"workspace '{workspace_name}' already exists but could not be resolved"
                )
            return existing

        data = self._json(response)
        workspace = data.get("workspace") if isinstance(data.get("workspace"), dict) else data
        if not isinstance(workspace, dict):
            raise CoderAPIError("Coder create workspace returned invalid shape")
        return workspace

    def start_workspace(self, workspace_id: str) -> Dict[str, Any]:
        return self._create_workspace_build(workspace_id, transition="start")

    def stop_workspace(self, workspace_id: str) -> Dict[str, Any]:
        return self._create_workspace_build(workspace_id, transition="stop")

    def _create_workspace_build(self, workspace_id: str, *, transition: str) -> Dict[str, Any]:
        payload = {"transition": transition}
        response = self._request(
            "POST",
            f"/api/v2/workspaces/{workspace_id}/builds",
            body=payload,
            expected=[200, 201, 202, 409],
        )
        if response.status_code == 409:
            return {
                "workspace_id": workspace_id,
                "transition": transition,
                "status": "active_build",
            }
        data = self._json(response)
        return data.get("build") if isinstance(data.get("build"), dict) else data

    @staticmethod
    def workspace_running(workspace: Dict[str, Any]) -> bool:
        latest_build = workspace.get("latest_build") if isinstance(workspace.get("latest_build"), dict) else {}
        status = str(latest_build.get("status") or workspace.get("status") or "").strip().lower()
        transition = str(latest_build.get("transition") or "").strip().lower()
        if transition == "stop":
            return False
        return status in {"running", "started", "ready", "active"}

    @staticmethod
    def workspace_ready(workspace: Dict[str, Any]) -> bool:
        if not CoderClient.workspace_running(workspace):
            return False

        latest_build = workspace.get("latest_build") if isinstance(workspace.get("latest_build"), dict) else {}
        resources = latest_build.get("resources")
        if not isinstance(resources, list) or not resources:
            # Some Coder API responses omit resource details; treat running as ready.
            return True

        any_agent = False
        any_connected = False
        for resource in resources:
            if not isinstance(resource, dict):
                continue
            agents = resource.get("agents")
            if not isinstance(agents, list):
                continue
            for agent in agents:
                if not isinstance(agent, dict):
                    continue
                any_agent = True
                state = str(agent.get("status") or agent.get("lifecycle_state") or "").strip().lower()
                if state in {"connected", "ready", "running", "started"}:
                    any_connected = True
        return any_connected if any_agent else True

    def wait_workspace_ready(
        self,
        workspace_id: str,
        *,
        timeout_seconds: int = 900,
        poll_seconds: float = 5,
    ) -> Dict[str, Any]:
        deadline = time.monotonic() + max(5, int(timeout_seconds))
        last_status = "unknown"
        while time.monotonic() < deadline:
            workspace = self.get_workspace(workspace_id)
            latest_build = workspace.get("latest_build") if isinstance(workspace.get("latest_build"), dict) else {}
            last_status = str(latest_build.get("status") or workspace.get("status") or "unknown")
            if self.workspace_ready(workspace):
                return workspace
            time.sleep(max(1.0, float(poll_seconds)))
        raise CoderAPIError(
            f"workspace {workspace_id} did not become ready before timeout; last_status={last_status}"
        )

    def extend_workspace(self, workspace_id: str, *, deadline_iso: str) -> Dict[str, Any]:
        payload = {"deadline": deadline_iso}
        response = self._request(
            "PUT",
            f"/api/v2/workspaces/{workspace_id}/extend",
            body=payload,
            expected=[200, 201, 202],
        )
        data = self._json(response)
        return data

    def list_port_shares(self, workspace_id: str) -> List[Dict[str, Any]]:
        response = self._request(
            "GET",
            f"/api/v2/workspaces/{workspace_id}/port-share",
            expected=[200],
        )
        data = self._json(response)
        shares = data.get("shares")
        if isinstance(shares, list):
            return [item for item in shares if isinstance(item, dict)]
        if isinstance(data, list):
            return [item for item in data if isinstance(item, dict)]
        return []

    def upsert_port_share(
        self,
        workspace_id: str,
        *,
        port: int,
        share_level: str = "authenticated",
        protocol: str = "http",
        agent_name: Optional[str] = None,
    ) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "port": int(port),
            "share_level": share_level,
            "protocol": protocol,
        }
        if agent_name:
            payload["agent_name"] = agent_name

        methods = ["PUT", "POST"]
        last_error: Optional[Exception] = None
        attempt_payloads = [dict(payload)]
        if not agent_name:
            inferred = self._first_workspace_agent_name(workspace_id)
            if inferred:
                with_agent = dict(payload)
                with_agent["agent_name"] = inferred
                attempt_payloads.append(with_agent)

        for candidate_payload in attempt_payloads:
            for method in methods:
                try:
                    response = self._request(
                        method,
                        f"/api/v2/workspaces/{workspace_id}/port-share",
                        body=candidate_payload,
                        expected=[200, 201, 202],
                    )
                    data = self._json(response)
                    return data.get("share") if isinstance(data.get("share"), dict) else data
                except Exception as exc:
                    last_error = exc
        raise CoderAPIError(f"failed to upsert port share for {workspace_id}: {last_error}")

    def list_workspace_agents(self, workspace_id: str) -> List[Dict[str, Any]]:
        workspace = self.get_workspace(workspace_id)
        latest_build = (
            workspace.get("latest_build")
            if isinstance(workspace.get("latest_build"), dict)
            else {}
        )
        resources = latest_build.get("resources")
        if not isinstance(resources, list):
            return []

        agents_out: List[Dict[str, Any]] = []
        for resource in resources:
            if not isinstance(resource, dict):
                continue
            agents = resource.get("agents")
            if not isinstance(agents, list):
                continue
            for agent in agents:
                if isinstance(agent, dict):
                    agents_out.append(agent)
        return agents_out

    def first_workspace_agent_name(self, workspace_id: str) -> Optional[str]:
        name = self._first_workspace_agent_name(workspace_id)
        return name if name else None

    def list_workspace_agent_listening_ports(self, agent_id: str) -> List[Dict[str, Any]]:
        response = self._request(
            "GET",
            f"/api/v2/workspaceagents/{agent_id}/listening-ports",
            expected=[200, 404],
        )
        if response.status_code == 404:
            return []
        data = self._json(response)
        ports = data.get("ports")
        if isinstance(ports, list):
            return [item for item in ports if isinstance(item, dict)]
        if isinstance(data, list):
            return [item for item in data if isinstance(item, dict)]
        return []

    @staticmethod
    def _extract_listening_port_value(entry: Dict[str, Any]) -> Optional[int]:
        for key in ["port", "listen_port", "local_port", "number"]:
            raw = entry.get(key)
            if raw is None:
                continue
            try:
                value = int(raw)
            except Exception:
                continue
            if 1 <= value <= 65535:
                return value
        return None

    def workspace_port_is_listening(
        self,
        *,
        workspace_id: str,
        port: int,
        agent_name: Optional[str] = None,
    ) -> bool:
        target_port = int(port)
        agents = self.list_workspace_agents(workspace_id)
        if not agents:
            return False

        preferred = (agent_name or "").strip().lower()
        ordered_agents: List[Dict[str, Any]] = []
        if preferred:
            ordered_agents.extend(
                [
                    agent
                    for agent in agents
                    if str(agent.get("name") or "").strip().lower() == preferred
                ]
            )
            ordered_agents.extend(
                [
                    agent
                    for agent in agents
                    if str(agent.get("name") or "").strip().lower() != preferred
                ]
            )
        else:
            ordered_agents = list(agents)

        for agent in ordered_agents:
            agent_id = str(agent.get("id") or "").strip()
            if not agent_id:
                continue
            try:
                listening = self.list_workspace_agent_listening_ports(agent_id)
            except Exception:
                continue
            for item in listening:
                value = self._extract_listening_port_value(item)
                if value == target_port:
                    return True
        return False

    def _first_workspace_agent_name(self, workspace_id: str) -> Optional[str]:
        try:
            workspace = self.get_workspace(workspace_id)
        except Exception:
            return None
        latest_build = workspace.get("latest_build")
        if not isinstance(latest_build, dict):
            return None
        resources = latest_build.get("resources")
        if not isinstance(resources, list):
            return None
        for resource in resources:
            if not isinstance(resource, dict):
                continue
            agents = resource.get("agents")
            if not isinstance(agents, list):
                continue
            for agent in agents:
                if not isinstance(agent, dict):
                    continue
                name = str(agent.get("name") or "").strip()
                if name:
                    return name
        return None

    def delete_port_share(self, workspace_id: str, *, port: int) -> None:
        payload = {"port": int(port)}
        self._request(
            "DELETE",
            f"/api/v2/workspaces/{workspace_id}/port-share",
            body=payload,
            expected=[200, 202, 204, 404],
        )

    def enforce_authenticated_port_shares(self, workspace_id: str) -> int:
        downgraded = 0
        try:
            shares = self.list_port_shares(workspace_id)
        except Exception as exc:
            logging.warning("port-share list failed for workspace %s: %s", workspace_id, exc)
            return downgraded

        for share in shares:
            level = str(
                share.get("share_level")
                or share.get("level")
                or share.get("access_level")
                or ""
            ).strip().lower()
            if level != "public":
                continue
            port_raw = share.get("port")
            if port_raw is None:
                port_raw = share.get("workspace_port")
            try:
                port = int(port_raw)
            except Exception:
                continue

            protocol = str(share.get("protocol") or "http").strip().lower() or "http"
            agent_name = str(share.get("agent_name") or share.get("workspace_agent_name") or "").strip() or None
            try:
                self.upsert_port_share(
                    workspace_id,
                    port=port,
                    share_level="authenticated",
                    protocol=protocol,
                    agent_name=agent_name,
                )
                downgraded += 1
            except Exception as exc:
                logging.warning(
                    "failed downgrading public share (workspace=%s port=%s): %s",
                    workspace_id,
                    port,
                    exc,
                )
        return downgraded

    @staticmethod
    def parse_share_url(share: Dict[str, Any]) -> Optional[str]:
        for key in ["url", "access_url", "share_url", "port_url"]:
            value = share.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()

        # Some APIs return nested metadata.
        meta = share.get("metadata") if isinstance(share.get("metadata"), dict) else {}
        value = meta.get("url")
        if isinstance(value, str) and value.strip():
            return value.strip()
        return None

    def _deployment_config(self) -> Dict[str, Any]:
        if isinstance(self._deployment_config_cache, dict):
            return self._deployment_config_cache
        try:
            response = self._request(
                "GET",
                "/api/v2/deployment/config",
                expected=[200],
            )
            payload = self._json(response)
            config = payload.get("config")
            if isinstance(config, dict):
                self._deployment_config_cache = config
                return config
        except Exception:
            pass
        self._deployment_config_cache = {}
        return self._deployment_config_cache

    def _wildcard_access_host(self) -> Optional[str]:
        config = self._deployment_config()
        wildcard_raw = str(config.get("wildcard_access_url") or "").strip()
        if not wildcard_raw:
            return None

        if "://" in wildcard_raw:
            parsed = urlparse(wildcard_raw)
            host = str(parsed.netloc or parsed.path or "").strip()
        else:
            host = wildcard_raw
        host = host.strip().lstrip("*.").strip(".")
        return host or None

    def build_workspace_port_url(
        self,
        *,
        owner_name: str,
        workspace_name: str,
        port: int,
        agent_name: Optional[str] = None,
        protocol: str = "http",
    ) -> str:
        owner = owner_name.strip()
        workspace = workspace_name.strip()
        if not owner or not workspace:
            raise ValueError("owner_name and workspace_name are required")
        agent = (agent_name or "").strip()
        protocol_name = (protocol or "http").strip().lower()
        wildcard_host = self._wildcard_access_host()
        if wildcard_host and agent:
            # Coder wildcard app URL format:
            # <port>[s]--<agent>--<workspace>--<owner>.<wildcard_access_host>
            # where "s" suffix on the port indicates upstream https.
            port_token = f"{int(port)}{'s' if protocol_name == 'https' else ''}"
            return (
                f"https://{port_token}--{agent}--{workspace}--{owner}.{wildcard_host}"
            )

        workspace_ref = f"{workspace}.{agent}" if agent else workspace
        return f"{self.base_url}/@{owner}/{workspace_ref}/ports/{int(port)}"

    @staticmethod
    def future_deadline_iso(hours: int) -> str:
        ts = datetime.utcnow().timestamp() + max(1, int(hours)) * 3600
        return datetime.utcfromtimestamp(ts).isoformat() + "Z"
