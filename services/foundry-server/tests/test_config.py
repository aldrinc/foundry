from __future__ import annotations

import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1] / "src"
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from foundry_server.config import (  # noqa: E402
    AppConfig,
    AuthProvider,
    DeploymentEnvironment,
    WorkspaceTopology,
    load_config,
)


class ConfigTests(unittest.TestCase):
    def test_defaults_match_expected_launch_shape(self) -> None:
        config = load_config({})

        self.assertIsInstance(config, AppConfig)
        self.assertEqual(config.environment, DeploymentEnvironment.LOCAL)
        self.assertEqual(config.auth_provider, AuthProvider.OIDC)
        self.assertEqual(config.workspace_topology, WorkspaceTopology.ORGANIZATION_POOLED)
        self.assertFalse(config.self_host_mode)
        self.assertFalse(config.github_webhook_secret_present)
        self.assertFalse(config.stripe_secret_key_present)

    def test_env_overrides_are_applied(self) -> None:
        config = load_config(
            {
                "FOUNDRY_ENVIRONMENT": "staging",
                "FOUNDRY_PORT": "9001",
                "FOUNDRY_SELF_HOST_MODE": "true",
                "FOUNDRY_SUPPORT_EMAIL": "support@foundry.test",
                "FOUNDRY_GITHUB_WEBHOOK_SECRET": "secret",
                "FOUNDRY_STRIPE_SECRET_KEY": "sk_test_123",
                "FOUNDRY_STRIPE_WEBHOOK_SECRET": "whsec_123",
                "FOUNDRY_ORG_WORKSPACE_POOL_SIZE": "8",
                "FOUNDRY_ORG_WORKSPACE_MAX_CONCURRENCY": "40",
            }
        )

        self.assertEqual(config.environment, DeploymentEnvironment.STAGING)
        self.assertEqual(config.port, 9001)
        self.assertTrue(config.self_host_mode)
        self.assertEqual(config.support_email, "support@foundry.test")
        self.assertTrue(config.github_webhook_secret_present)
        self.assertTrue(config.stripe_secret_key_present)
        self.assertTrue(config.stripe_webhook_secret_present)
        self.assertEqual(config.organization_workspace_pool_size, 8)
        self.assertEqual(config.organization_workspace_max_concurrency, 40)


if __name__ == "__main__":
    unittest.main()
