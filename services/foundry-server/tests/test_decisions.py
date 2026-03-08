from __future__ import annotations

import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1] / "src"
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from foundry_server.decisions import LAUNCH_DECISIONS  # noqa: E402


class LaunchDecisionTests(unittest.TestCase):
    def test_confirmed_launch_defaults_are_captured(self) -> None:
        self.assertEqual(LAUNCH_DECISIONS.repo_strategy, "monorepo")
        self.assertEqual(LAUNCH_DECISIONS.auth_model, "external_oidc")
        self.assertEqual(LAUNCH_DECISIONS.github_integration_model, "github_app")
        self.assertEqual(LAUNCH_DECISIONS.billing_model, "hybrid")
        self.assertEqual(LAUNCH_DECISIONS.runtime_credential_ownership, "organization")
        self.assertEqual(LAUNCH_DECISIONS.workspace_tenancy, "organization")
        self.assertEqual(LAUNCH_DECISIONS.workspace_topology, "organization_pooled")
        self.assertEqual(
            LAUNCH_DECISIONS.desktop_platforms,
            ("macos", "windows", "linux"),
        )


if __name__ == "__main__":
    unittest.main()
