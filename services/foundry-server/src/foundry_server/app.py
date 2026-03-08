from __future__ import annotations

from fastapi import FastAPI

from .config import AppConfig, load_config
from .decisions import LAUNCH_DECISIONS


def create_app(config: AppConfig | None = None) -> FastAPI:
    server_config = config or load_config()

    app = FastAPI(
        title="Foundry Server",
        version="0.1.0",
        summary="Product-facing Foundry server scaffold.",
    )
    app.state.config = server_config

    @app.get("/health")
    def health() -> dict[str, object]:
        return {
            "status": "ok",
            "service": "foundry-server",
            "environment": server_config.environment.value,
            "self_host_mode": server_config.self_host_mode,
            "workspace_topology": server_config.workspace_topology.value,
        }

    @app.get("/api/v1/meta/launch-decisions")
    def launch_decisions() -> dict[str, object]:
        return LAUNCH_DECISIONS.to_dict()

    @app.get("/api/v1/meta/bootstrap")
    def bootstrap_summary() -> dict[str, object]:
        return {
            "service": "foundry-server",
            "config": server_config.public_summary(),
            "launch_decisions": LAUNCH_DECISIONS.to_dict(),
            "next_steps": [
                "Add OIDC-backed hosted auth and self-host bootstrap auth.",
                "Add GitHub App installation and repository binding APIs.",
                "Add server-backed runtime and agent settings persistence.",
                "Migrate orchestration and workspace policy from the internal service.",
            ],
        }

    return app


app = create_app()
