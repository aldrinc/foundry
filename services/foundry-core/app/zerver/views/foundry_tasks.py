from __future__ import annotations

import base64
import json
import logging
import os
import re
from typing import Any
from urllib.parse import quote, urljoin, urlparse

import requests
from django.core.files.uploadedfile import UploadedFile
from django.http import HttpRequest, HttpResponse, StreamingHttpResponse
from django.utils.translation import gettext as _
from pydantic import Json, NonNegativeInt

from zerver.lib.exceptions import ErrorCode, JsonableError
from zerver.lib.upload import check_upload_within_quota, upload_message_attachment_from_request
from zerver.lib.response import json_success
from zerver.lib.streams import access_stream_by_id
from zerver.lib.topic import messages_for_topic
from zerver.lib.typed_endpoint import PathOnly, typed_endpoint, typed_endpoint_without_parameters
from zerver.models import Realm, UserProfile
from zerver.views.upload import generate_unauthed_file_access_url


_USER_UPLOAD_LINK_RE = re.compile(r"(?P<url>(?:https?://[^\s)]+)?/user_uploads/(?!temporary/)[^\s)]+)")


def _host_prefers_https(host: str) -> bool:
    normalized_host = host.strip().split(":", 1)[0].lower()
    if not normalized_host or normalized_host in {"localhost", "testserver"}:
        return False
    if normalized_host.endswith(".testserver"):
        return False
    if normalized_host in {"127.0.0.1", "::1"}:
        return False
    if re.match(r"^127\.\d+\.\d+\.\d+$", normalized_host):
        return False
    if re.match(r"^10\.\d+\.\d+\.\d+$", normalized_host):
        return False
    if re.match(r"^192\.168\.\d+\.\d+$", normalized_host):
        return False
    if re.match(r"^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$", normalized_host):
        return False
    return True


def _first_env(*names: str, default: str = "") -> str:
    for name in names:
        raw = os.getenv(name)
        if raw is None:
            continue
        value = raw.strip()
        if value:
            return value
    return default


def _env_bool(*names: str, default: bool) -> bool:
    raw = _first_env(*names)
    if not raw:
        return default
    return raw.lower() in {"1", "true", "yes", "on", "y"}


def _boolish(value: str | bool | None, *, default: bool = True) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    normalized = str(value).strip().lower()
    if normalized in {"1", "true", "yes", "on", "y"}:
        return True
    if normalized in {"0", "false", "no", "off", "n"}:
        return False
    return default


class FoundryOrchestratorConfigurationError(JsonableError):
    code = ErrorCode.BAD_REQUEST

    def __init__(self) -> None:
        super().__init__(
            _(
                "Foundry task orchestration is not configured on this server."
                " Set FOUNDRY_SERVER_URL or FOUNDRY_CODER_ORCHESTRATOR_URL."
            )
        )


class FoundryOrchestratorRequestError(JsonableError):
    code = ErrorCode.BAD_REQUEST

    def __init__(self, message: str) -> None:
        super().__init__(message)


class FoundryServerConfigurationError(JsonableError):
    code = ErrorCode.BAD_REQUEST

    def __init__(self) -> None:
        super().__init__(
            _(
                "Foundry inbox assistant is not configured on this server."
                " Set FOUNDRY_SERVER_URL."
            )
        )


class FoundryServerRequestError(JsonableError):
    code = ErrorCode.BAD_REQUEST

    def __init__(self, message: str) -> None:
        super().__init__(message)


def _orchestrator_url() -> str:
    explicit = _first_env(
        "FOUNDRY_CODER_ORCHESTRATOR_URL",
        "MERIDIAN_CODER_ORCHESTRATOR_URL",
        "FOUNDRY_URL",
    ).rstrip("/")
    if explicit:
        return explicit
    foundry_server_url = _foundry_server_url()
    if foundry_server_url:
        return f"{foundry_server_url}/api/v1/meridian"
    return ""


def _orchestrator_configured() -> bool:
    return bool(_orchestrator_url())


def _orchestrator_token() -> str:
    return _first_env("FOUNDRY_CODER_ORCHESTRATOR_TOKEN", "FOUNDRY_TOKEN")


def _orchestrator_timeout_seconds() -> float:
    raw = _first_env("FOUNDRY_CODER_ORCHESTRATOR_TIMEOUT_SECONDS", default="25")
    try:
        value = float(raw)
    except Exception:
        value = 25.0
    return max(2.0, value)


def _orchestrator_supervisor_timeout_seconds() -> float:
    raw = _first_env("FOUNDRY_CODER_ORCHESTRATOR_SUPERVISOR_TIMEOUT_SECONDS", default="140")
    try:
        value = float(raw)
    except Exception:
        value = 140.0
    return max(_orchestrator_timeout_seconds(), value)


def _orchestrator_verify_tls() -> bool:
    return _env_bool("FOUNDRY_CODER_ORCHESTRATOR_VERIFY_TLS", "FOUNDRY_VERIFY_TLS", default=True)


def _provider_oauth_redirect_uri(
    request: HttpRequest,
    redirect_uri: str | None,
) -> str | None:
    normalized_redirect_uri = (redirect_uri or "").strip()
    if normalized_redirect_uri:
        return normalized_redirect_uri
    host = request.get_host().strip()
    if host:
        scheme = "https" if request.is_secure() or _host_prefers_https(host) else "http"
        return f"{scheme}://{host}/json/foundry/providers/oauth/callback"
    try:
        return request.build_absolute_uri("/json/foundry/providers/oauth/callback").strip() or None
    except Exception:
        return None


def _foundry_server_url() -> str:
    return _first_env("FOUNDRY_SERVER_URL").rstrip("/")


def _foundry_server_timeout_seconds() -> float:
    raw = _first_env("FOUNDRY_SERVER_TIMEOUT_SECONDS", default="90")
    try:
        value = float(raw)
    except Exception:
        value = 90.0
    return max(2.0, value)


def _foundry_server_verify_tls() -> bool:
    return _env_bool("FOUNDRY_SERVER_VERIFY_TLS", default=True)


def _orchestrator_inline_upload_max_bytes() -> int:
    raw = _first_env("FOUNDRY_CODER_ORCHESTRATOR_INLINE_UPLOAD_MAX_BYTES", default=str(2 * 1024 * 1024))
    try:
        value = int(raw)
    except Exception:
        value = 2 * 1024 * 1024
    return max(0, value)


def _repo_url_map() -> dict[str, str]:
    raw = _first_env("FOUNDRY_REPO_URL_MAP_JSON")
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except Exception:
        return {}
    if not isinstance(parsed, dict):
        return {}
    out: dict[str, str] = {}
    for key, value in parsed.items():
        repo_id = str(key).strip()
        repo_url = str(value).strip()
        if repo_id and repo_url:
            out[repo_id] = repo_url
    return out


def _resolve_repo_url(repo_id: str, explicit_repo_url: str | None) -> str:
    candidate = str(explicit_repo_url or "").strip()
    if candidate:
        return candidate

    mapping = _repo_url_map()
    if repo_id in mapping:
        return mapping[repo_id]

    base = (
        os.getenv("FOUNDRY_GIT_BASE_URL")
        or os.getenv("GITHUB_BASE_URL")
        or "https://github.com"
    ).strip().rstrip("/")
    if not base:
        return ""
    return f"{base}/{repo_id}.git"


def _default_repo_id() -> str:
    return _first_env("FOUNDRY_DEFAULT_REPO_ID")


def _empty_sidebar_payload(topic_scope_id: str) -> dict[str, Any]:
    return {
        "topic_scope_id": topic_scope_id,
        "task_count": 0,
        "counts": {},
        "tasks": [],
    }


def _empty_task_summary_payload() -> dict[str, Any]:
    return {
        "active_plan_revision_id": None,
        "filtered_plan_revision_id": None,
        "task_count": 0,
        "counts": {},
        "all_task_count": 0,
        "all_counts": {},
        "tasks": [],
    }


def _empty_runtime_payload(topic_scope_id: str) -> dict[str, Any]:
    return {
        "topic_scope_id": topic_scope_id,
        "workspace_path": "",
        "uploads_path": "",
        "outputs_path": "",
        "checkpoints_path": "",
        "memory_summary": "",
        "memory_highlights": [],
        "uploads": [],
        "new_uploads": [],
        "upload_count": 0,
        "checkpoint_count": 0,
        "last_request_checkpoint": "",
        "last_response_checkpoint": "",
        "sessions": [],
        "session_count": 0,
    }


def _empty_provider_catalog_payload() -> dict[str, Any]:
    return {
        "providers": [],
        "allowed_providers": [],
        "default_provider": "",
    }


def _empty_integration_catalog_payload() -> dict[str, Any]:
    return {
        "integrations": [],
        "default_policy": {
            "enabled_integrations": [],
            "auto_topic_transcript": True,
            "auto_repo_context": True,
            "allow_external_integrations": True,
        },
    }


def _empty_integration_list_payload() -> dict[str, Any]:
    return {
        "integrations": [],
        "policy": {
            "enabled_integrations": [],
            "auto_topic_transcript": True,
            "auto_repo_context": True,
            "allow_external_integrations": True,
        },
        "stored_policy": None,
    }


def _normalize_provider_name(value: str) -> str:
    normalized = (value or "").strip().lower()
    aliases = {
        "open_code": "opencode",
        "claude": "claude_code",
        "claudecode": "claude_code",
        "cloud_code": "claude_code",
    }
    return aliases.get(normalized, normalized)


def _normalize_integration_name(value: str) -> str:
    normalized = (value or "").strip().lower()
    aliases = {
        "forjo": "forgejo",
        "gitea": "forgejo",
        "cal.com": "calcom",
        "cal_com": "calcom",
    }
    return aliases.get(normalized, normalized)


def _topic_scope_id(stream_id: int, topic: str) -> str:
    return f"stream_id:{int(stream_id)}:topic:{topic}".strip().lower()


def _parse_topic_scope_id(topic_scope_id: str) -> tuple[int, str] | None:
    scoped = (topic_scope_id or "").strip().lower()
    if not scoped:
        return None
    prefix = "stream_id:"
    marker = ":topic:"
    if not scoped.startswith(prefix):
        return None
    remainder = scoped[len(prefix) :]
    if marker not in remainder:
        return None
    stream_part, topic = remainder.split(marker, 1)
    try:
        stream_id = int(stream_part)
    except Exception:
        return None
    topic_name = topic.strip()
    return stream_id, topic_name


def _raise_file_too_large(user_profile: UserProfile, max_size_mib: int) -> None:
    if user_profile.realm.plan_type != Realm.PLAN_TYPE_SELF_HOSTED:
        raise JsonableError(
            _(
                "File is larger than the maximum upload size ({max_size} MiB) allowed by your organization's plan."
            ).format(max_size=max_size_mib)
        )
    raise JsonableError(
        _("File is larger than this server's configured maximum upload size ({max_size} MiB).").format(
            max_size=max_size_mib
        )
    )


def _temporary_upload_absolute_url(user_profile: UserProfile, upload_url: str) -> str:
    raw = str(upload_url or "").strip()
    if not raw:
        return ""

    parsed = urlparse(raw)
    path = parsed.path if parsed.scheme or parsed.netloc else raw
    path = str(path or "").strip()
    if not path.startswith("/user_uploads/"):
        return raw
    if path.startswith("/user_uploads/temporary/"):
        return raw

    realm_host = urlparse(user_profile.realm.url).netloc.strip().lower()
    if parsed.netloc and parsed.netloc.strip().lower() != realm_host:
        return raw

    if path.startswith("/user_uploads/download/"):
        path_id = path.removeprefix("/user_uploads/download/")
    else:
        path_id = path.removeprefix("/user_uploads/")
    path_id = path_id.lstrip("/")
    if not path_id or path_id.startswith("temporary/"):
        return raw

    temporary_path = generate_unauthed_file_access_url(path_id)
    return urljoin(f"{user_profile.realm.url}/", temporary_path.lstrip("/"))


def _rewrite_supervisor_upload_links(message: str, user_profile: UserProfile) -> str:
    raw = str(message or "").strip()
    if not raw or "/user_uploads/" not in raw:
        return raw

    def replace(match: re.Match[str]) -> str:
        url = match.group("url")
        rewritten = _temporary_upload_absolute_url(user_profile, url)
        return rewritten or url

    return _USER_UPLOAD_LINK_RE.sub(replace, raw)


def _supervisor_uploaded_files(
    request: HttpRequest, user_profile: UserProfile
) -> list[dict[str, Any]]:
    uploaded_files: list[UploadedFile] = []
    for _field_name, file_list in request.FILES.lists():
        for user_file in file_list:
            if isinstance(user_file, UploadedFile):
                uploaded_files.append(user_file)

    if not uploaded_files:
        return []

    max_size_mib = user_profile.realm.get_max_file_upload_size_mebibytes()
    inline_upload_max_bytes = _orchestrator_inline_upload_max_bytes()
    uploaded_links: list[dict[str, Any]] = []
    for user_file in uploaded_files:
        file_size = user_file.size
        assert file_size is not None
        if file_size > max_size_mib * 1024 * 1024:
            _raise_file_too_large(user_profile, max_size_mib)
        check_upload_within_quota(user_profile.realm, file_size)
        inline_content_base64 = ""
        if file_size <= inline_upload_max_bytes:
            try:
                inline_bytes = user_file.read()
            except Exception:
                inline_bytes = b""
            if inline_bytes:
                inline_content_base64 = base64.b64encode(inline_bytes).decode("ascii")
            try:
                user_file.seek(0)
            except Exception:
                pass
        relative_url, filename = upload_message_attachment_from_request(user_file, user_profile)
        absolute_url = _temporary_upload_absolute_url(user_profile, relative_url)
        payload_item: dict[str, Any] = {
            "filename": filename,
            "url": absolute_url,
            "size": int(file_size),
            "media_type": str(getattr(user_file, "content_type", "") or "").strip() or None,
        }
        if inline_content_base64:
            payload_item["content_base64"] = inline_content_base64
        uploaded_links.append(payload_item)

    return uploaded_links


def _append_uploaded_files_to_message(
    message: str, uploaded_files: list[dict[str, str]]
) -> str:
    normalized_message = message.strip()
    if not uploaded_files:
        return normalized_message

    attachment_lines = [
        f'- [{item["filename"]}]({item["url"]})'
        for item in uploaded_files
        if item.get("filename") and item.get("url")
    ]
    if not attachment_lines:
        return normalized_message

    attachment_block = "Attached files:\n" + "\n".join(attachment_lines)
    if not normalized_message:
        return attachment_block
    return f"{normalized_message}\n\n{attachment_block}"


def _fetch_topic_transcript(
    user_profile: UserProfile,
    *,
    stream_id: int,
    topic: str,
    limit: int = 80,
) -> list[dict[str, Any]]:
    """
    Return a bounded transcript of messages for the given (stream_id, topic).

    This is used for supervisor plan synthesis so the orchestrator can synthesize
    a plan from human discussion, not only from task metadata.
    """
    stream, _sub = access_stream_by_id(user_profile, int(stream_id))
    qs = (
        messages_for_topic(user_profile.realm_id, stream.recipient_id, topic)
        .select_related("sender")
        .order_by("-id")[: max(0, int(limit))]
    )
    items = list(qs)
    items.reverse()
    out: list[dict[str, Any]] = []
    for message in items:
        content = (message.content or "").strip()
        if len(content) > 2200:
            content = f"{content[:2197].rstrip()}..."
        sender = message.sender
        out.append(
            {
                "id": message.id,
                "ts": message.date_sent.isoformat(),
                "sender_id": message.sender_id,
                "sender_full_name": getattr(sender, "full_name", "") or "",
                "sender_email": getattr(sender, "email", "") or "",
                "content": content,
            }
        )
    return out


def _orchestrator_request(
    method: str,
    path: str,
    *,
    params: dict[str, Any] | None = None,
    payload: dict[str, Any] | None = None,
    timeout: float | tuple[float, float | None] | None = None,
) -> dict[str, Any]:
    base_url = _orchestrator_url()
    if not base_url:
        raise FoundryOrchestratorConfigurationError()

    url = f"{base_url}{path}"
    headers: dict[str, str] = {"Content-Type": "application/json"}
    token = _orchestrator_token()
    if token:
        headers["Authorization"] = f"Bearer {token}"

    try:
        with requests.Session() as session:
            # The orchestrator is an internal service and should be called directly.
            # Zulip's proxy environment can deny private ranges, which breaks this path.
            session.trust_env = False
            response = session.request(
                method=method.upper(),
                url=url,
                params=params,
                json=payload,
                headers=headers,
                timeout=timeout if timeout is not None else _orchestrator_timeout_seconds(),
                verify=_orchestrator_verify_tls(),
            )
    except requests.RequestException as exc:
        raise FoundryOrchestratorRequestError(
            _("Foundry orchestrator request failed: {error}").format(error=str(exc))
        ) from exc

    response_body_snippet = (response.text or "")[:700]
    if response.status_code >= 400:
        try:
            parsed = response.json()
        except Exception:
            parsed = {}
        detail = ""
        if isinstance(parsed, dict):
            detail = str(parsed.get("detail") or parsed.get("msg") or "").strip()
        if not detail:
            detail = response_body_snippet
        raise FoundryOrchestratorRequestError(
            _("Foundry orchestrator returned {status}: {detail}").format(
                status=response.status_code,
                detail=detail or _("empty error response"),
            )
        )

    try:
        data = response.json()
    except Exception as exc:
        raise FoundryOrchestratorRequestError(
            _("Foundry orchestrator returned invalid JSON: {error}").format(error=str(exc))
        ) from exc

    if not isinstance(data, dict):
        raise FoundryOrchestratorRequestError(
            _("Foundry orchestrator returned an unexpected response shape.")
        )
    return data


def _orchestrator_stream_response(
    path: str,
    *,
    params: dict[str, Any] | None = None,
) -> StreamingHttpResponse:
    base_url = _orchestrator_url()
    if not base_url:
        raise FoundryOrchestratorConfigurationError()

    url = f"{base_url}{path}"
    headers: dict[str, str] = {"Accept": "text/event-stream"}
    token = _orchestrator_token()
    if token:
        headers["Authorization"] = f"Bearer {token}"

    session = requests.Session()
    session.trust_env = False
    try:
        response = session.request(
            method="GET",
            url=url,
            params=params,
            headers=headers,
            stream=True,
            timeout=(_orchestrator_timeout_seconds(), None),
            verify=_orchestrator_verify_tls(),
        )
    except requests.RequestException as exc:
        session.close()
        raise FoundryOrchestratorRequestError(
            _("Foundry orchestrator request failed: {error}").format(error=str(exc))
        ) from exc

    if response.status_code >= 400:
        response_body_snippet = ""
        try:
            response_body_snippet = (response.text or "")[:700]
        except Exception:
            response_body_snippet = ""
        detail = response_body_snippet or _("empty error response")
        response.close()
        session.close()
        raise FoundryOrchestratorRequestError(
            _("Foundry orchestrator returned {status}: {detail}").format(
                status=response.status_code,
                detail=detail,
            )
        )

    def stream() -> Any:
        try:
            # Preserve the upstream SSE chunk boundaries so keepalives and small
            # event frames flush through the Zulip proxy immediately.
            for chunk in response.iter_content(chunk_size=None):
                if chunk:
                    yield chunk
        finally:
            response.close()
            session.close()

    streaming = StreamingHttpResponse(stream(), content_type="text/event-stream")
    streaming["Cache-Control"] = "no-cache"
    streaming["X-Accel-Buffering"] = "no"
    return streaming


def _foundry_server_request(
    method: str,
    path: str,
    *,
    payload: dict[str, Any] | None = None,
    timeout: float | tuple[float, float | None] | None = None,
) -> dict[str, Any]:
    base_url = _foundry_server_url()
    if not base_url:
        raise FoundryServerConfigurationError()

    url = f"{base_url}{path}"
    headers: dict[str, str] = {"Content-Type": "application/json"}

    try:
        with requests.Session() as session:
            session.trust_env = False
            response = session.request(
                method=method.upper(),
                url=url,
                json=payload,
                headers=headers,
                timeout=timeout if timeout is not None else _foundry_server_timeout_seconds(),
                verify=_foundry_server_verify_tls(),
            )
    except requests.RequestException as exc:
        raise FoundryServerRequestError(
            _("Foundry inbox assistant request failed: {error}").format(error=str(exc))
        ) from exc

    response_body_snippet = (response.text or "")[:700]
    if response.status_code >= 400:
        try:
            parsed = response.json()
        except Exception:
            parsed = {}
        detail = ""
        if isinstance(parsed, dict):
            detail = str(parsed.get("detail") or parsed.get("msg") or "").strip()
        if not detail:
            detail = response_body_snippet
        raise FoundryServerRequestError(
            _("Foundry inbox assistant returned {status}: {detail}").format(
                status=response.status_code,
                detail=detail or _("empty error response"),
            )
        )

    try:
        data = response.json()
    except Exception as exc:
        raise FoundryServerRequestError(
            _("Foundry inbox assistant returned invalid JSON: {error}").format(error=str(exc))
        ) from exc

    if not isinstance(data, dict):
        raise FoundryServerRequestError(
            _("Foundry inbox assistant returned an unexpected response shape.")
        )
    return data


def _foundry_inbox_assistant_payload(user_profile: UserProfile) -> dict[str, Any]:
    actor_email = (user_profile.delivery_email or user_profile.email).strip().lower()
    realm_url = user_profile.realm.url.rstrip("/")
    return {
        "org_key": realm_url,
        "realm_url": realm_url,
        "user_email": actor_email,
    }


@typed_endpoint
def foundry_create_task(
    request: HttpRequest,
    user_profile: UserProfile,
    *,
    stream_id: Json[int],
    topic: str,
    instruction: str,
    stream_name: str | None = None,
    repo_id: str | None = None,
    repo_url: str | None = None,
    provider: str | None = None,
    task_title: str | None = None,
    message_id: Json[int] | None = None,
    assigned_worker: str | None = None,
    assigned_role: str | None = None,
    directive_id: str | None = None,
    plan_revision_id: str | None = None,
    depends_on_task_ids: Json[list[str]] | None = None,
    file_claims: Json[list[str]] | None = None,
    area_claims: Json[list[str]] | None = None,
) -> HttpResponse:
    normalized_topic = topic.strip()
    normalized_instruction = instruction.strip()
    if not normalized_topic:
        raise FoundryOrchestratorRequestError(_("topic is required"))
    if not normalized_instruction:
        raise FoundryOrchestratorRequestError(_("instruction is required"))

    effective_repo_id = str(repo_id or "").strip() or _default_repo_id()
    if not effective_repo_id:
        raise FoundryOrchestratorRequestError(
            _("repo_id is required; set FOUNDRY_DEFAULT_REPO_ID or provide repo_id")
        )
    effective_repo_url = _resolve_repo_url(effective_repo_id, repo_url)
    if not effective_repo_url:
        raise FoundryOrchestratorRequestError(_("unable to resolve repo_url"))

    provider_name = _normalize_provider_name(provider or "codex")
    scope_id = _topic_scope_id(int(stream_id), normalized_topic)
    actor_email = (user_profile.delivery_email or user_profile.email).strip().lower()

    thread_ref: dict[str, Any] = {
        "message_type": "stream",
        "stream_id": int(stream_id),
        "stream": (stream_name or "").strip(),
        "topic": normalized_topic,
    }
    if message_id is not None:
        thread_ref["message_id"] = int(message_id)

    task_options: dict[str, Any] = {"source": "zulip_ui"}
    if task_title:
        task_options["task_title"] = task_title.strip()
    if depends_on_task_ids:
        task_options["depends_on_task_ids"] = [
            str(item).strip() for item in depends_on_task_ids if str(item).strip()
        ]
    if file_claims:
        task_options["file_claims"] = [str(item).strip() for item in file_claims if str(item).strip()]
    if area_claims:
        task_options["area_claims"] = [str(item).strip() for item in area_claims if str(item).strip()]

    payload = {
        "user_id": actor_email,
        "repo_id": effective_repo_id,
        "repo_url": effective_repo_url,
        "provider": provider_name,
        "instruction": normalized_instruction,
        "zulip_thread_ref": thread_ref,
        "topic_scope_id": scope_id,
        "task_title": task_title.strip() if task_title else None,
        "options": task_options,
        "assigned_worker": (assigned_worker or "").strip() or None,
        "assigned_role": (assigned_role or "").strip() or None,
        "assigned_by": actor_email,
        "directive_id": (directive_id or "").strip() or None,
        "plan_revision_id": (plan_revision_id or "").strip() or None,
    }

    response = _orchestrator_request("POST", "/api/tasks", payload=payload)
    return json_success(
        request,
        data={
            "topic_scope_id": scope_id,
            "task": response.get("task"),
            "workspace": response.get("workspace"),
            "raw": response,
        },
    )


@typed_endpoint_without_parameters
def foundry_inbox_assistant_session(
    request: HttpRequest,
    user_profile: UserProfile,
) -> HttpResponse:
    response = _foundry_server_request(
        "POST",
        "/api/v1/desktop/inbox-secretary/session",
        payload=_foundry_inbox_assistant_payload(user_profile),
    )
    return json_success(request, data=response)


@typed_endpoint
def foundry_inbox_assistant_chat(
    request: HttpRequest,
    user_profile: UserProfile,
    *,
    api_key: str,
    message: str,
    current_user_id: Json[NonNegativeInt] | None = None,
) -> HttpResponse:
    payload = _foundry_inbox_assistant_payload(user_profile)
    payload.update(
        {
            "api_key": api_key,
            "message": message,
            "current_user_id": int(current_user_id) if current_user_id is not None else None,
        }
    )
    response = _foundry_server_request(
        "POST",
        "/api/v1/desktop/inbox-secretary/chat",
        payload=payload,
    )
    return json_success(request, data=response)


@typed_endpoint
def foundry_inbox_assistant_feedback(
    request: HttpRequest,
    user_profile: UserProfile,
    *,
    item_key: str,
    conversation_key: str | None = None,
    action: str,
    note: str | None = None,
) -> HttpResponse:
    payload = _foundry_inbox_assistant_payload(user_profile)
    payload.update(
        {
            "item_key": item_key,
            "conversation_key": (conversation_key or "").strip(),
            "action": action.strip().lower(),
            "note": (note or "").strip(),
        }
    )
    response = _foundry_server_request(
        "POST",
        "/api/v1/desktop/inbox-secretary/feedback",
        payload=payload,
    )
    return json_success(request, data=response)


@typed_endpoint
def foundry_topic_sidebar(
    request: HttpRequest,
    user_profile: UserProfile,
    *,
    topic_scope_id: PathOnly[str],
    limit: Json[NonNegativeInt] = 50,
    session_id: str | None = None,
) -> HttpResponse:
    del user_profile  # authenticated access check only
    scoped = topic_scope_id.strip().lower()
    if not _orchestrator_configured():
        empty_sidebar = _empty_sidebar_payload(scoped)
        return json_success(
            request,
            data={
                "configured": False,
                **empty_sidebar,
                "topic_scope_id": scoped,
                "sidebar": empty_sidebar,
                "raw": {},
            },
        )
    encoded_scope = quote(scoped, safe="")
    response = _orchestrator_request(
        "GET",
        f"/api/topics/{encoded_scope}/sidebar",
        params={
            "limit": int(limit),
            **({"session_id": str(session_id).strip()} if str(session_id or "").strip() else {}),
        },
    )
    sidebar_payload = response if isinstance(response, dict) else {}
    return json_success(
        request,
        data={
            **sidebar_payload,
            "topic_scope_id": scoped,
            "sidebar": sidebar_payload,
            "raw": response,
        },
    )


@typed_endpoint
def foundry_topic_events(
    request: HttpRequest,
    user_profile: UserProfile,
    *,
    topic_scope_id: PathOnly[str],
    after_id: Json[NonNegativeInt] = 0,
    limit: Json[NonNegativeInt] = 200,
) -> HttpResponse:
    del user_profile  # authenticated access check only
    scoped = topic_scope_id.strip().lower()
    encoded_scope = quote(scoped, safe="")
    response = _orchestrator_request(
        "GET",
        f"/api/topics/{encoded_scope}/events",
        params={"after_id": int(after_id), "limit": int(limit)},
    )
    return json_success(
        request,
        data={"topic_scope_id": scoped, "events": response.get("events"), "raw": response},
    )


@typed_endpoint
def foundry_topic_supervisor_session(
    request: HttpRequest,
    user_profile: UserProfile,
    *,
    topic_scope_id: PathOnly[str],
    after_id: Json[NonNegativeInt] = 0,
    limit: Json[NonNegativeInt] = 200,
    session_id: str | None = None,
) -> HttpResponse:
    del user_profile  # authenticated access check only
    scoped = topic_scope_id.strip().lower()
    if not _orchestrator_configured():
        return json_success(
            request,
            data={
                "configured": False,
                "topic_scope_id": scoped,
                "session": None,
                "sessions": [],
                "events": [],
                "task_summary": _empty_task_summary_payload(),
                "next_after_id": int(after_id),
                "raw": {},
            },
        )
    encoded_scope = quote(scoped, safe="")
    response = _orchestrator_request(
        "GET",
        f"/api/topics/{encoded_scope}/supervisor/session",
        params={
            "after_id": int(after_id),
            "limit": int(limit),
            **({"session_id": str(session_id).strip()} if str(session_id or "").strip() else {}),
        },
    )
    return json_success(
        request,
        data={
            "topic_scope_id": scoped,
            "session": response.get("session"),
            "sessions": response.get("sessions") or [],
            "events": response.get("events"),
            "task_summary": response.get("task_summary") or _empty_task_summary_payload(),
            "next_after_id": response.get("next_after_id"),
            "raw": response,
        },
    )


@typed_endpoint
def foundry_topic_supervisor_runtime(
    request: HttpRequest,
    user_profile: UserProfile,
    *,
    topic_scope_id: PathOnly[str],
    session_id: str | None = None,
) -> HttpResponse:
    del user_profile  # authenticated access check only
    scoped = topic_scope_id.strip().lower()
    if not _orchestrator_configured():
        return json_success(
            request,
            data={
                "configured": False,
                "topic_scope_id": scoped,
                "session": None,
                "sessions": [],
                "runtime": _empty_runtime_payload(scoped),
                "raw": {},
            },
        )
    encoded_scope = quote(scoped, safe="")
    response = _orchestrator_request(
        "GET",
        f"/api/topics/{encoded_scope}/supervisor/runtime",
        params={
            **({"session_id": str(session_id).strip()} if str(session_id or "").strip() else {}),
        },
    )
    return json_success(
        request,
        data={
            "topic_scope_id": scoped,
            "session": response.get("session"),
            "sessions": response.get("sessions") or [],
            "runtime": response.get("runtime") or _empty_runtime_payload(scoped),
            "raw": response,
        },
    )


@typed_endpoint
def foundry_topic_supervisor_session_stream(
    request: HttpRequest,
    user_profile: UserProfile,
    *,
    topic_scope_id: PathOnly[str],
    after_id: Json[NonNegativeInt] = 0,
    session_id: str | None = None,
    poll_interval_seconds: float | None = None,
    heartbeat_seconds: float | None = None,
) -> HttpResponse:
    del request, user_profile  # authenticated access check only
    scoped = topic_scope_id.strip().lower()
    encoded_scope = quote(scoped, safe="")
    params: dict[str, Any] = {"after_id": int(after_id)}
    if session_id is not None and str(session_id).strip():
        params["session_id"] = str(session_id).strip()
    if poll_interval_seconds is not None:
        params["poll_interval_seconds"] = float(poll_interval_seconds)
    if heartbeat_seconds is not None:
        params["heartbeat_seconds"] = float(heartbeat_seconds)
    return _orchestrator_stream_response(
        f"/api/topics/{encoded_scope}/supervisor/session/stream",
        params=params,
    )


@typed_endpoint
def foundry_topic_supervisor_session_reset(
    request: HttpRequest,
    user_profile: UserProfile,
    *,
    topic_scope_id: PathOnly[str],
    session_id: str | None = None,
    clear_events: str | None = None,
) -> HttpResponse:
    scoped = topic_scope_id.strip().lower()
    encoded_scope = quote(scoped, safe="")
    actor_email = (user_profile.delivery_email or user_profile.email).strip().lower()
    response = _orchestrator_request(
        "POST",
        f"/api/topics/{encoded_scope}/supervisor/session/reset",
        payload={
            "session_id": (session_id or "").strip() or None,
            "clear_events": _boolish(clear_events, default=True),
            "actor_user_id": actor_email,
            "actor_email": actor_email,
        },
    )
    return json_success(
        request,
        data={
            "topic_scope_id": scoped,
            "session": response.get("session"),
            "sessions": response.get("sessions") or [],
            "events": response.get("events"),
            "next_after_id": response.get("next_after_id"),
            "raw": response,
        },
    )


@typed_endpoint
def foundry_topic_supervisor_message(
    request: HttpRequest,
    user_profile: UserProfile,
    *,
    topic_scope_id: PathOnly[str],
    message: str,
    session_id: str | None = None,
    session_create_mode: str | None = None,
    session_title: str | None = None,
    client_msg_id: str | None = None,
    repo_id: str | None = None,
    repo_url: str | None = None,
    stream_id: str | None = None,
    stream_name: str | None = None,
    topic: str | None = None,
) -> HttpResponse:
    scoped = topic_scope_id.strip().lower()
    encoded_scope = quote(scoped, safe="")
    uploaded_files = _supervisor_uploaded_files(request, user_profile)
    normalized_message = _append_uploaded_files_to_message(message, uploaded_files)
    normalized_message = _rewrite_supervisor_upload_links(normalized_message, user_profile)
    if not normalized_message:
        raise FoundryOrchestratorRequestError(_("message is required"))

    actor_email = (user_profile.delivery_email or user_profile.email).strip().lower()
    normalized_stream_id: int | None = None
    if stream_id is not None:
        candidate = str(stream_id).strip()
        if candidate:
            try:
                normalized_stream_id = int(candidate)
            except Exception:
                normalized_stream_id = None

    payload: dict[str, Any] = {
        "message": normalized_message,
        "session_id": (session_id or "").strip() or None,
        "session_create_mode": (session_create_mode or "").strip() or None,
        "session_title": (session_title or "").strip() or None,
        "client_msg_id": (client_msg_id or "").strip() or None,
        "actor_user_id": actor_email,
        "actor_email": actor_email,
        "actor_name": (user_profile.full_name or actor_email).strip() or actor_email,
        "repo_id": (repo_id or "").strip() or None,
        "repo_url": (repo_url or "").strip() or None,
        "stream_id": normalized_stream_id,
        "stream_name": (stream_name or "").strip() if stream_name is not None else None,
        "topic": (topic or "").strip() if topic is not None else None,
        "topic_transcript": [],
        "uploaded_files": uploaded_files,
    }

    try:
        transcript_stream_id: int | None = None
        transcript_topic_name: str | None = None
        if payload["stream_id"] is not None and payload["topic"] is not None:
            transcript_stream_id = int(payload["stream_id"])
            transcript_topic_name = str(payload["topic"]).strip()
        else:
            parsed = _parse_topic_scope_id(scoped)
            if parsed is not None:
                transcript_stream_id, transcript_topic_name = parsed
                stream, _sub = access_stream_by_id(user_profile, int(transcript_stream_id))
                payload["stream_id"] = int(transcript_stream_id)
                payload["stream_name"] = stream.name
                payload["topic"] = transcript_topic_name
        if transcript_stream_id is not None and transcript_topic_name is not None:
            if not payload["stream_name"]:
                stream, _sub = access_stream_by_id(user_profile, int(transcript_stream_id))
                payload["stream_name"] = stream.name
            transcript = _fetch_topic_transcript(
                user_profile,
                stream_id=int(transcript_stream_id),
                topic=transcript_topic_name,
                limit=120,
            )
            payload["topic_transcript"] = transcript
    except Exception as exc:
        logging.warning("foundry supervisor message transcript fetch failed: %s", exc)

    response = _orchestrator_request(
        "POST",
        f"/api/topics/{encoded_scope}/supervisor/message",
        payload=payload,
        timeout=(_orchestrator_timeout_seconds(), _orchestrator_supervisor_timeout_seconds()),
    )
    return json_success(
        request,
        data={
            "topic_scope_id": scoped,
            "session": response.get("session"),
            "sessions": response.get("sessions") or [],
            "events": response.get("events"),
            "task_summary": response.get("task_summary") or _empty_task_summary_payload(),
            "next_after_id": response.get("next_after_id"),
            "uploaded_files": uploaded_files,
            "raw": response,
        },
    )


@typed_endpoint
def foundry_topic_plan_revisions(
    request: HttpRequest,
    user_profile: UserProfile,
    *,
    topic_scope_id: PathOnly[str],
    limit: Json[NonNegativeInt] = 50,
    session_id: str | None = None,
) -> HttpResponse:
    del user_profile  # authenticated access check only
    scoped = topic_scope_id.strip().lower()
    if not _orchestrator_configured():
        return json_success(
            request,
            data={
                "configured": False,
                "topic_scope_id": scoped,
                "plan_revisions": [],
                "raw": {},
            },
        )
    encoded_scope = quote(scoped, safe="")
    response = _orchestrator_request(
        "GET",
        f"/api/topics/{encoded_scope}/plan/revisions",
        params={
            "limit": int(limit),
            **({"session_id": str(session_id).strip()} if str(session_id or "").strip() else {}),
        },
    )
    return json_success(
        request,
        data={
            "topic_scope_id": scoped,
            "plan_revisions": response.get("plan_revisions"),
            "raw": response,
        },
    )


@typed_endpoint
def foundry_topic_plan_current(
    request: HttpRequest,
    user_profile: UserProfile,
    *,
    topic_scope_id: PathOnly[str],
    session_id: str | None = None,
) -> HttpResponse:
    del user_profile  # authenticated access check only
    scoped = topic_scope_id.strip().lower()
    if not _orchestrator_configured():
        return json_success(
            request,
            data={
                "configured": False,
                "topic_scope_id": scoped,
                "plan_revision": None,
                "raw": {},
            },
        )
    encoded_scope = quote(scoped, safe="")
    response = _orchestrator_request(
        "GET",
        f"/api/topics/{encoded_scope}/plan/current",
        params={
            **({"session_id": str(session_id).strip()} if str(session_id or "").strip() else {}),
        },
    )
    return json_success(
        request,
        data={
            "topic_scope_id": scoped,
            "plan_revision": response.get("plan_revision"),
            "raw": response,
        },
    )


@typed_endpoint
def foundry_topic_plan_create(
    request: HttpRequest,
    user_profile: UserProfile,
    *,
    topic_scope_id: PathOnly[str],
    summary: str = "",
    objective: str = "",
    assumptions: Json[list[str]] | None = None,
    unknowns: Json[list[str]] | None = None,
    execution_steps: Json[list[dict[str, Any]]] | None = None,
    candidate_parallel_seams: Json[list[dict[str, Any]]] | None = None,
    approval_points: Json[list[str]] | None = None,
    source: Json[dict[str, Any]] | None = None,
    status: str = "active",
    plan_revision_id: str | None = None,
) -> HttpResponse:
    scoped = topic_scope_id.strip().lower()
    encoded_scope = quote(scoped, safe="")
    actor_email = (user_profile.delivery_email or user_profile.email).strip().lower()
    payload = {
        "author_id": actor_email,
        "summary": summary.strip(),
        "objective": objective.strip(),
        "assumptions": [str(item).strip() for item in (assumptions or []) if str(item).strip()],
        "unknowns": [str(item).strip() for item in (unknowns or []) if str(item).strip()],
        "execution_steps": [item for item in (execution_steps or []) if isinstance(item, dict)],
        "candidate_parallel_seams": [
            item for item in (candidate_parallel_seams or []) if isinstance(item, dict)
        ],
        "approval_points": [str(item).strip() for item in (approval_points or []) if str(item).strip()],
        "source": source if isinstance(source, dict) else {},
        "status": (status or "active").strip().lower() or "active",
        "plan_revision_id": (plan_revision_id or "").strip() or None,
    }
    response = _orchestrator_request(
        "POST",
        f"/api/topics/{encoded_scope}/plan/revisions",
        payload=payload,
    )
    return json_success(
        request,
        data={
            "topic_scope_id": scoped,
            "plan_revision": response.get("plan_revision"),
            "raw": response,
        },
    )


@typed_endpoint
def foundry_topic_plan_synthesize(
    request: HttpRequest,
    user_profile: UserProfile,
    *,
    topic_scope_id: PathOnly[str],
    summary: str = "",
    objective: str = "",
    assumptions: Json[list[str]] | None = None,
    unknowns: Json[list[str]] | None = None,
    execution_steps: Json[list[dict[str, Any]]] | None = None,
    approval_points: Json[list[str]] | None = None,
    source: Json[dict[str, Any]] | None = None,
    activate: Json[bool] = False,
) -> HttpResponse:
    scoped = topic_scope_id.strip().lower()
    encoded_scope = quote(scoped, safe="")
    actor_email = (user_profile.delivery_email or user_profile.email).strip().lower()
    merged_source: dict[str, Any] = dict(source) if isinstance(source, dict) else {}
    # Include a bounded topic transcript so the supervisor can synthesize a plan from
    # the human discussion in the topic thread.
    try:
        parsed = _parse_topic_scope_id(scoped)
        if parsed is not None:
            stream_id, topic_name = parsed
            transcript = _fetch_topic_transcript(
                user_profile,
                stream_id=stream_id,
                topic=topic_name,
                limit=80,
            )
            merged_source.setdefault(
                "topic",
                {
                    "stream_id": stream_id,
                    "topic": topic_name,
                },
            )
            merged_source["topic_transcript"] = transcript
            merged_source["topic_transcript_count"] = len(transcript)
    except Exception as exc:
        logging.warning("foundry supervisor transcript fetch failed: %s", exc)
    payload = {
        "author_id": actor_email,
        "summary": summary.strip(),
        "objective": objective.strip(),
        "assumptions": [str(item).strip() for item in (assumptions or []) if str(item).strip()],
        "unknowns": [str(item).strip() for item in (unknowns or []) if str(item).strip()],
        "execution_steps": [item for item in (execution_steps or []) if isinstance(item, dict)],
        "approval_points": [str(item).strip() for item in (approval_points or []) if str(item).strip()],
        "source": merged_source,
        "activate": bool(activate),
    }
    response = _orchestrator_request(
        "POST",
        f"/api/topics/{encoded_scope}/plan/synthesize",
        payload=payload,
    )
    return json_success(
        request,
        data={
            "topic_scope_id": scoped,
            "synthesized": response.get("synthesized"),
            "plan_revision": response.get("plan_revision"),
            "raw": response,
        },
    )


@typed_endpoint_without_parameters
def foundry_provider_catalog(
    request: HttpRequest,
    user_profile: UserProfile,
) -> HttpResponse:
    del user_profile  # authenticated access check only
    if not _orchestrator_configured():
        empty = _empty_provider_catalog_payload()
        return json_success(
            request,
            data={
                "configured": False,
                "providers": empty["providers"],
                "allowed_providers": empty["allowed_providers"],
                "default_provider": empty["default_provider"],
                "raw": empty,
            },
        )
    response = _orchestrator_request("GET", "/api/providers")
    return json_success(
        request,
        data={
            "providers": response.get("providers"),
            "allowed_providers": response.get("allowed_providers"),
            "default_provider": response.get("default_provider"),
            "raw": response,
        },
    )


@typed_endpoint_without_parameters
def foundry_provider_auth_list(
    request: HttpRequest,
    user_profile: UserProfile,
) -> HttpResponse:
    actor_email = (user_profile.delivery_email or user_profile.email).strip().lower()
    if not _orchestrator_configured():
        return json_success(
            request,
            data={
                "configured": False,
                "user_id": actor_email,
                "providers": [],
                "raw": {"providers": []},
            },
        )
    encoded_user = quote(actor_email, safe="")
    response = _orchestrator_request("GET", f"/api/users/{encoded_user}/providers/auth")
    return json_success(
        request,
        data={
            "user_id": actor_email,
            "providers": response.get("providers"),
            "raw": response,
        },
    )


@typed_endpoint
def foundry_provider_auth_connect(
    request: HttpRequest,
    user_profile: UserProfile,
    *,
    provider: str,
    auth_mode: str = "api_key",
    label: str | None = None,
    api_key: str | None = None,
    access_token: str | None = None,
    refresh_token: str | None = None,
    id_token: str | None = None,
    account_id: str | None = None,
    expires_at: str | None = None,
    metadata: Json[dict[str, Any]] | None = None,
) -> HttpResponse:
    actor_email = (user_profile.delivery_email or user_profile.email).strip().lower()
    normalized_provider = _normalize_provider_name(provider)
    if not normalized_provider:
        raise FoundryOrchestratorRequestError(_("provider is required"))

    payload = {
        "auth_mode": (auth_mode or "api_key").strip().lower() or "api_key",
        "label": (label or "").strip() or None,
        "api_key": (api_key or "").strip() or None,
        "access_token": (access_token or "").strip() or None,
        "refresh_token": (refresh_token or "").strip() or None,
        "id_token": (id_token or "").strip() or None,
        "account_id": (account_id or "").strip() or None,
        "expires_at": (expires_at or "").strip() or None,
        "metadata": metadata if isinstance(metadata, dict) else {},
        "actor_user_id": actor_email,
        "actor_email": actor_email,
    }

    encoded_user = quote(actor_email, safe="")
    encoded_provider = quote(normalized_provider, safe="")
    response = _orchestrator_request(
        "POST",
        f"/api/users/{encoded_user}/providers/{encoded_provider}/connect",
        payload=payload,
    )
    return json_success(
        request,
        data={
            "user_id": actor_email,
            "provider": normalized_provider,
            "credential": response.get("credential"),
            "raw": response,
        },
    )


@typed_endpoint
def foundry_provider_auth_disconnect(
    request: HttpRequest,
    user_profile: UserProfile,
    *,
    provider: str,
) -> HttpResponse:
    actor_email = (user_profile.delivery_email or user_profile.email).strip().lower()
    normalized_provider = _normalize_provider_name(provider)
    if not normalized_provider:
        raise FoundryOrchestratorRequestError(_("provider is required"))

    payload = {
        "actor_user_id": actor_email,
        "actor_email": actor_email,
    }
    encoded_user = quote(actor_email, safe="")
    encoded_provider = quote(normalized_provider, safe="")
    response = _orchestrator_request(
        "POST",
        f"/api/users/{encoded_user}/providers/{encoded_provider}/disconnect",
        payload=payload,
    )
    return json_success(
        request,
        data={
            "user_id": actor_email,
            "provider": normalized_provider,
            "credential": response.get("credential"),
            "raw": response,
        },
    )


@typed_endpoint
def foundry_provider_oauth_start(
    request: HttpRequest,
    user_profile: UserProfile,
    *,
    provider: str,
    redirect_uri: str | None = None,
) -> HttpResponse:
    actor_email = (user_profile.delivery_email or user_profile.email).strip().lower()
    normalized_provider = _normalize_provider_name(provider)
    if not normalized_provider:
        raise FoundryOrchestratorRequestError(_("provider is required"))

    payload = {
        "redirect_uri": _provider_oauth_redirect_uri(request, redirect_uri),
        "actor_user_id": actor_email,
        "actor_email": actor_email,
    }

    encoded_user = quote(actor_email, safe="")
    encoded_provider = quote(normalized_provider, safe="")
    response = _orchestrator_request(
        "POST",
        f"/api/users/{encoded_user}/providers/{encoded_provider}/oauth/start",
        payload=payload,
    )
    return json_success(
        request,
        data={
            "user_id": actor_email,
            "provider": normalized_provider,
            "authorize_url": response.get("authorize_url"),
            "state": response.get("state"),
            "expires_at": response.get("expires_at"),
            "raw": response,
        },
    )


@typed_endpoint
def foundry_provider_oauth_callback(
    request: HttpRequest,
    user_profile: UserProfile,
    *,
    state: str,
    code: str | None = None,
    error: str | None = None,
    error_description: str | None = None,
) -> HttpResponse:
    actor_email = (user_profile.delivery_email or user_profile.email).strip().lower()
    normalized_state = state.strip()
    if not normalized_state:
        raise FoundryOrchestratorRequestError(_("state is required"))

    payload = {
        "state": normalized_state,
        "code": (code or "").strip() or None,
        "error": (error or "").strip() or None,
        "error_description": (error_description or "").strip() or None,
        "actor_user_id": actor_email,
        "actor_email": actor_email,
    }

    status = "ok"
    detail = "OAuth sign-in completed. You can close this window and continue in Zulip."
    try:
        _orchestrator_request("POST", "/api/providers/oauth/callback", payload=payload)
    except FoundryOrchestratorRequestError as exc:
        status = "error"
        detail = str(exc)

    safe_detail = json.dumps(detail)
    safe_status = json.dumps(status)
    html = f"""<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Provider OAuth</title>
  <style>
    body {{ font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif; margin: 24px; color: #111827; }}
    .card {{ max-width: 560px; border: 1px solid #d1d5db; border-radius: 10px; padding: 16px 18px; background: #fff; }}
    .ok {{ color: #065f46; }}
    .error {{ color: #991b1b; }}
    code {{ background: #f3f4f6; padding: 1px 4px; border-radius: 4px; }}
  </style>
</head>
<body>
  <div class="card">
    <h2 class="{status}">Foundry OAuth: {status.upper()}</h2>
    <p id="msg"></p>
    <p>Return to your task dialog and continue.</p>
  </div>
  <script>
    const status = {safe_status};
    const detail = {safe_detail};
    document.getElementById("msg").textContent = detail;
    if (status === "ok" && window.opener) {{
      try {{ window.opener.postMessage({{source: "foundry_oauth", status, detail}}, "*"); }} catch (e) {{}}
      setTimeout(() => window.close(), 700);
    }}
  </script>
</body>
</html>"""
    return HttpResponse(html)


@typed_endpoint_without_parameters
def foundry_integration_catalog(
    request: HttpRequest,
    user_profile: UserProfile,
) -> HttpResponse:
    del user_profile  # authenticated access check only
    if not _orchestrator_configured():
        empty = _empty_integration_catalog_payload()
        return json_success(
            request,
            data={
                "configured": False,
                "integrations": empty["integrations"],
                "default_policy": empty["default_policy"],
                "raw": empty,
            },
        )
    response = _orchestrator_request("GET", "/api/integrations")
    return json_success(
        request,
        data={
            "integrations": response.get("integrations"),
            "default_policy": response.get("default_policy"),
            "raw": response,
        },
    )


@typed_endpoint_without_parameters
def foundry_integration_list(
    request: HttpRequest,
    user_profile: UserProfile,
) -> HttpResponse:
    actor_email = (user_profile.delivery_email or user_profile.email).strip().lower()
    if not _orchestrator_configured():
        empty = _empty_integration_list_payload()
        return json_success(
            request,
            data={
                "configured": False,
                "user_id": actor_email,
                "integrations": empty["integrations"],
                "policy": empty["policy"],
                "stored_policy": empty["stored_policy"],
                "raw": empty,
            },
        )
    encoded_user = quote(actor_email, safe="")
    response = _orchestrator_request("GET", f"/api/users/{encoded_user}/integrations")
    return json_success(
        request,
        data={
            "user_id": actor_email,
            "integrations": response.get("integrations"),
            "policy": response.get("policy"),
            "stored_policy": response.get("stored_policy"),
            "raw": response,
        },
    )


@typed_endpoint
def foundry_integration_connect(
    request: HttpRequest,
    user_profile: UserProfile,
    *,
    integration: str,
    auth_mode: str = "api_key",
    label: str | None = None,
    api_key: str | None = None,
    access_token: str | None = None,
    refresh_token: str | None = None,
    token: str | None = None,
    metadata: Json[dict[str, Any]] | None = None,
) -> HttpResponse:
    actor_email = (user_profile.delivery_email or user_profile.email).strip().lower()
    normalized_integration = _normalize_integration_name(integration)
    if not normalized_integration:
        raise FoundryOrchestratorRequestError(_("integration is required"))

    payload = {
        "auth_mode": (auth_mode or "api_key").strip().lower() or "api_key",
        "label": (label or "").strip() or None,
        "api_key": (api_key or "").strip() or None,
        "access_token": (access_token or "").strip() or None,
        "refresh_token": (refresh_token or "").strip() or None,
        "token": (token or "").strip() or None,
        "metadata": metadata if isinstance(metadata, dict) else {},
        "actor_user_id": actor_email,
        "actor_email": actor_email,
    }

    encoded_user = quote(actor_email, safe="")
    encoded_integration = quote(normalized_integration, safe="")
    response = _orchestrator_request(
        "POST",
        f"/api/users/{encoded_user}/integrations/{encoded_integration}/connect",
        payload=payload,
    )
    return json_success(
        request,
        data={
            "user_id": actor_email,
            "integration": normalized_integration,
            "credential": response.get("credential"),
            "raw": response,
        },
    )


@typed_endpoint
def foundry_integration_disconnect(
    request: HttpRequest,
    user_profile: UserProfile,
    *,
    integration: str,
) -> HttpResponse:
    actor_email = (user_profile.delivery_email or user_profile.email).strip().lower()
    normalized_integration = _normalize_integration_name(integration)
    if not normalized_integration:
        raise FoundryOrchestratorRequestError(_("integration is required"))

    payload = {
        "actor_user_id": actor_email,
        "actor_email": actor_email,
    }
    encoded_user = quote(actor_email, safe="")
    encoded_integration = quote(normalized_integration, safe="")
    response = _orchestrator_request(
        "POST",
        f"/api/users/{encoded_user}/integrations/{encoded_integration}/disconnect",
        payload=payload,
    )
    return json_success(
        request,
        data={
            "user_id": actor_email,
            "integration": normalized_integration,
            "credential": response.get("credential"),
            "raw": response,
        },
    )


@typed_endpoint
def foundry_integration_policy_update(
    request: HttpRequest,
    user_profile: UserProfile,
    *,
    policy: Json[dict[str, Any]] | None = None,
    merge: bool = True,
) -> HttpResponse:
    actor_email = (user_profile.delivery_email or user_profile.email).strip().lower()
    payload = {
        "policy": policy if isinstance(policy, dict) else {},
        "merge": bool(merge),
        "actor_user_id": actor_email,
        "actor_email": actor_email,
    }
    encoded_user = quote(actor_email, safe="")
    response = _orchestrator_request(
        "POST",
        f"/api/users/{encoded_user}/integrations/policy",
        payload=payload,
    )
    return json_success(
        request,
        data={
            "user_id": actor_email,
            "policy": response.get("policy"),
            "stored_policy": response.get("stored_policy"),
            "raw": response,
        },
    )


@typed_endpoint
def foundry_task_status(
    request: HttpRequest,
    user_profile: UserProfile,
    *,
    task_id: PathOnly[str],
) -> HttpResponse:
    del user_profile  # authenticated access check only
    normalized_task_id = task_id.strip()
    encoded_task_id = quote(normalized_task_id, safe="")
    response = _orchestrator_request("GET", f"/api/tasks/{encoded_task_id}")
    return json_success(
        request,
        data={"task_id": normalized_task_id, "task": response.get("task"), "raw": response},
    )


@typed_endpoint
def foundry_task_events(
    request: HttpRequest,
    user_profile: UserProfile,
    *,
    task_id: PathOnly[str],
    after_id: Json[NonNegativeInt] = 0,
    limit: Json[NonNegativeInt] = 200,
) -> HttpResponse:
    del user_profile  # authenticated access check only
    normalized_task_id = task_id.strip()
    encoded_task_id = quote(normalized_task_id, safe="")
    response = _orchestrator_request(
        "GET",
        f"/api/tasks/{encoded_task_id}/events",
        params={"after_id": int(after_id), "limit": int(limit)},
    )
    return json_success(
        request,
        data={"task_id": normalized_task_id, "events": response.get("events"), "raw": response},
    )


@typed_endpoint
def foundry_task_events_stream(
    request: HttpRequest,
    user_profile: UserProfile,
    *,
    task_id: PathOnly[str],
    after_id: Json[NonNegativeInt] = 0,
    poll_interval_seconds: float | None = None,
    heartbeat_seconds: float | None = None,
) -> HttpResponse:
    del request, user_profile  # authenticated access check only
    normalized_task_id = task_id.strip()
    encoded_task_id = quote(normalized_task_id, safe="")
    params: dict[str, Any] = {"after_id": int(after_id)}
    if poll_interval_seconds is not None:
        params["poll_interval_seconds"] = float(poll_interval_seconds)
    if heartbeat_seconds is not None:
        params["heartbeat_seconds"] = float(heartbeat_seconds)
    return _orchestrator_stream_response(
        f"/api/tasks/{encoded_task_id}/events/stream",
        params=params,
    )


@typed_endpoint
def foundry_task_action(
    request: HttpRequest,
    user_profile: UserProfile,
    *,
    task_id: PathOnly[str],
    action: str,
    note: str | None = None,
    retry_instruction: str | None = None,
    retry_provider: str | None = None,
) -> HttpResponse:
    normalized_task_id = task_id.strip()
    normalized_action = action.strip().lower()
    if not normalized_action:
        raise FoundryOrchestratorRequestError(_("action is required"))

    actor_email = (user_profile.delivery_email or user_profile.email).strip().lower()
    payload: dict[str, Any] = {
        "actor_user_id": actor_email,
        "actor_email": actor_email,
    }
    if note:
        payload["note"] = note.strip()
    if retry_instruction:
        payload["retry_instruction"] = retry_instruction.strip()
    if retry_provider:
        payload["retry_provider"] = retry_provider.strip().lower()

    encoded_task_id = quote(normalized_task_id, safe="")
    encoded_action = quote(normalized_action, safe="")
    response = _orchestrator_request(
        "POST",
        f"/api/tasks/{encoded_task_id}/actions/{encoded_action}",
        payload=payload,
    )
    return json_success(
        request,
        data={
            "task_id": normalized_task_id,
            "action": normalized_action,
            "task": response.get("task"),
            "result": response.get("result"),
            "raw": response,
        },
    )


@typed_endpoint
def foundry_task_needs_clarification(
    request: HttpRequest,
    user_profile: UserProfile,
    *,
    task_id: PathOnly[str],
    reason: str,
    questions: Json[list[str]] | None = None,
) -> HttpResponse:
    normalized_task_id = task_id.strip()
    normalized_reason = reason.strip()
    if not normalized_reason:
        raise FoundryOrchestratorRequestError(_("reason is required"))

    actor_email = (user_profile.delivery_email or user_profile.email).strip().lower()
    payload: dict[str, Any] = {
        "reason": normalized_reason,
        "questions": [str(item).strip() for item in (questions or []) if str(item).strip()],
        "actor_user_id": actor_email,
        "actor_email": actor_email,
    }

    encoded_task_id = quote(normalized_task_id, safe="")
    response = _orchestrator_request(
        "POST",
        f"/api/tasks/{encoded_task_id}/needs-clarification",
        payload=payload,
    )
    return json_success(
        request,
        data={
            "task_id": normalized_task_id,
            "task": response.get("task"),
            "raw": response,
        },
    )


@typed_endpoint
def foundry_task_resolve_clarification(
    request: HttpRequest,
    user_profile: UserProfile,
    *,
    task_id: PathOnly[str],
    guidance: str,
) -> HttpResponse:
    normalized_task_id = task_id.strip()
    normalized_guidance = guidance.strip()
    if not normalized_guidance:
        raise FoundryOrchestratorRequestError(_("guidance is required"))

    actor_email = (user_profile.delivery_email or user_profile.email).strip().lower()
    payload: dict[str, Any] = {
        "guidance": normalized_guidance,
        "actor_user_id": actor_email,
        "actor_email": actor_email,
    }

    encoded_task_id = quote(normalized_task_id, safe="")
    response = _orchestrator_request(
        "POST",
        f"/api/tasks/{encoded_task_id}/resolve-clarification",
        payload=payload,
    )
    return json_success(
        request,
        data={
            "task_id": normalized_task_id,
            "task": response.get("task"),
            "raw": response,
        },
    )


@typed_endpoint
def foundry_task_reply(
    request: HttpRequest,
    user_profile: UserProfile,
    *,
    task_id: PathOnly[str],
    message: str,
) -> HttpResponse:
    normalized_task_id = task_id.strip()
    normalized_message = message.strip()
    if not normalized_message:
        raise FoundryOrchestratorRequestError(_("message is required"))

    actor_email = (user_profile.delivery_email or user_profile.email).strip().lower()
    payload: dict[str, Any] = {
        "message": normalized_message,
        "actor_user_id": actor_email,
        "actor_email": actor_email,
    }

    encoded_task_id = quote(normalized_task_id, safe="")
    response = _orchestrator_request(
        "POST",
        f"/api/tasks/{encoded_task_id}/reply",
        payload=payload,
    )
    return json_success(
        request,
        data={
            "task_id": normalized_task_id,
            "reply": response,
            "raw": response,
        },
    )


@typed_endpoint_without_parameters
def foundry_supervisor_context(
    request: HttpRequest,
    user_profile: UserProfile,
) -> HttpResponse:
    del user_profile  # authenticated access check only
    if not _orchestrator_configured():
        return json_success(
            request,
            data={
                "configured": False,
                "soul": None,
                "memory_tail": [],
                "paths": {},
                "raw": {},
            },
        )
    response = _orchestrator_request("GET", "/api/supervisor/context")
    return json_success(
        request,
        data={
            "soul": response.get("soul"),
            "memory_tail": response.get("memory_tail"),
            "paths": response.get("paths"),
            "raw": response,
        },
    )


@typed_endpoint
def foundry_supervisor_memory_append(
    request: HttpRequest,
    user_profile: UserProfile,
    *,
    title: str,
    detail: str,
    tags: Json[list[str]] | None = None,
) -> HttpResponse:
    normalized_title = title.strip()
    normalized_detail = detail.strip()
    if not normalized_title:
        raise FoundryOrchestratorRequestError(_("title is required"))
    if not normalized_detail:
        raise FoundryOrchestratorRequestError(_("detail is required"))

    actor_email = (user_profile.delivery_email or user_profile.email).strip().lower()
    payload: dict[str, Any] = {
        "title": normalized_title,
        "detail": normalized_detail,
        "tags": [str(item).strip() for item in (tags or []) if str(item).strip()],
        "actor_user_id": actor_email,
        "actor_email": actor_email,
    }
    response = _orchestrator_request("POST", "/api/supervisor/memory", payload=payload)
    return json_success(
        request,
        data={
            "memory_path": response.get("memory_path"),
            "raw": response,
        },
    )
