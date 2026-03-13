from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from fastapi.testclient import TestClient


ROOT = Path(__file__).resolve().parents[1] / "src"
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from foundry_server.app import create_app  # noqa: E402
from foundry_server.config import load_config  # noqa: E402


class OrchestrationMountTests(unittest.TestCase):
    def test_foundry_server_mounts_orchestration_health_endpoint(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir, mock.patch.dict(os.environ, {}, clear=False):
            tmp = Path(tmpdir)
            config = load_config(
                {
                    "FOUNDRY_DATABASE_PATH": str(tmp / "foundry-server.db"),
                    "FOUNDRY_ORCHESTRATION_RUN_STORE_PATH": str(tmp / "foundry-orchestrator.db"),
                    "FOUNDRY_ORCHESTRATION_SUPERVISOR_DIR": str(tmp / "supervisor"),
                    "FOUNDRY_ORCHESTRATION_LOCAL_WORK_ROOT": str(tmp / "local-work"),
                    "FOUNDRY_ORCHESTRATION_API_TOKEN": "",
                    "FOUNDRY_ORCHESTRATION_ENABLED": "true",
                }
            )
            client = TestClient(create_app(config))

            response = client.get("/api/v1/meridian/health")

            self.assertEqual(response.status_code, 200)
            payload = response.json()
            self.assertEqual(payload["status"], "ok")
            self.assertEqual(payload["supervisor_dir"], str((tmp / "supervisor").resolve()))
            self.assertTrue((tmp / "supervisor").is_dir())
            self.assertTrue((tmp / "local-work").is_dir())


if __name__ == "__main__":
    unittest.main()
