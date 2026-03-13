from __future__ import annotations

import importlib
import os
import sys
from pathlib import Path

from fastapi import FastAPI

from ..config import AppConfig


def _set_env(name: str, value: str) -> None:
    text = str(value or "").strip()
    if text:
        os.environ[name] = text


def _set_bool_env(name: str, value: bool) -> None:
    os.environ[name] = "true" if value else "false"


def configure_orchestration_environment(config: AppConfig) -> None:
    run_store_path = Path(config.orchestration_run_store_path).expanduser()
    supervisor_dir = Path(config.orchestration_supervisor_dir).expanduser()
    local_work_root = Path(config.orchestration_local_work_root).expanduser()

    run_store_path.parent.mkdir(parents=True, exist_ok=True)
    supervisor_dir.mkdir(parents=True, exist_ok=True)
    local_work_root.mkdir(parents=True, exist_ok=True)

    _set_env("RUN_STORE_PATH", str(run_store_path))
    _set_env("SUPERVISOR_DIR", str(supervisor_dir))
    _set_env("LOCAL_WORK_ROOT", str(local_work_root))
    _set_env("WORKER_ID", "foundry-orchestrator")
    _set_bool_env("VERIFY_TLS", config.orchestration_verify_tls)

    if config.orchestration_api_token:
        _set_env("ORCHESTRATOR_API_TOKEN", config.orchestration_api_token)
    if config.orchestration_policy_path:
        _set_env("ORCHESTRATOR_POLICY_PATH", config.orchestration_policy_path)

    coder_base_url = config.coder_internal_url or config.coder_url
    if coder_base_url:
        _set_env("CODER_BASE_URL", coder_base_url)
    if config.coder_api_token:
        _set_env("CODER_API_TOKEN", config.coder_api_token)
    if config.anthropic_api_key:
        _set_env("ANTHROPIC_API_KEY", config.anthropic_api_key)
    if config.github_api_url:
        _set_env("GITHUB_API_BASE_URL", config.github_api_url)


def create_orchestration_app(config: AppConfig) -> FastAPI:
    configure_orchestration_environment(config)
    module_name = "foundry_server.orchestration.app"
    if module_name in sys.modules:
        module = importlib.reload(sys.modules[module_name])
    else:
        module = importlib.import_module(module_name)
    return module.app
