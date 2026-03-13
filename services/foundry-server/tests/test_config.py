from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest import mock


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
        self.assertFalse(config.github_app_private_key_present)
        self.assertFalse(config.github_webhook_secret_present)
        self.assertFalse(config.coder_api_token_present)
        self.assertFalse(config.stripe_secret_key_present)
        self.assertFalse(config.anthropic_api_key_present)
        self.assertEqual(config.anthropic_api_base_url, "https://api.anthropic.com")
        self.assertEqual(config.anthropic_model, "claude-sonnet-4-6")
        self.assertTrue(config.orchestration_enabled)
        self.assertEqual(config.orchestration_mount_path, "/api/v1/meridian")
        self.assertEqual(config.orchestration_run_store_path, "./data/foundry-orchestrator.db")
        self.assertFalse(config.orchestration_api_token_present)
        self.assertEqual(config.orchestration_supervisor_dir, "./data/supervisor")
        self.assertEqual(config.orchestration_local_work_root, "./data/local-work")

    def test_env_overrides_are_applied(self) -> None:
        config = load_config(
            {
                "FOUNDRY_ENVIRONMENT": "staging",
                "FOUNDRY_PORT": "9001",
                "FOUNDRY_SELF_HOST_MODE": "true",
                "FOUNDRY_AUTH_PROVIDER": "local_password",
                "FOUNDRY_SUPPORT_EMAIL": "support@foundry.test",
                "FOUNDRY_BOOTSTRAP_ADMIN_EMAIL": "admin@foundry.test",
                "FOUNDRY_BOOTSTRAP_ADMIN_PASSWORD": "local-password",
                "FOUNDRY_CORE_URL": "https://core.foundry.test",
                "FOUNDRY_CORE_BOOTSTRAP_SECRET": "core-secret",
                "FOUNDRY_CORE_REALM_KEY_OVERRIDE": "__root__",
                "FOUNDRY_ANTHROPIC_API_KEY": "anthropic-secret",
                "FOUNDRY_ANTHROPIC_API_BASE_URL": "https://anthropic-proxy.foundry.test",
                "FOUNDRY_ANTHROPIC_MODEL": "claude-opus-test",
                "FOUNDRY_GITHUB_APP_PRIVATE_KEY_PATH": "/tmp/foundry.pem",
                "FOUNDRY_GITHUB_WEBHOOK_SECRET": "secret",
                "FOUNDRY_CODER_URL": "https://coder.foundry.test",
                "FOUNDRY_CODER_API_TOKEN": "coder-token",
                "FOUNDRY_STRIPE_SECRET_KEY": "sk_test_123",
                "FOUNDRY_STRIPE_WEBHOOK_SECRET": "whsec_123",
                "FOUNDRY_ORG_WORKSPACE_POOL_SIZE": "8",
                "FOUNDRY_ORG_WORKSPACE_MAX_CONCURRENCY": "40",
                "FOUNDRY_SESSION_MAX_AGE_DAYS": "30",
                "FOUNDRY_ORCHESTRATION_ENABLED": "false",
                "FOUNDRY_ORCHESTRATION_MOUNT_PATH": "/internal/orchestration",
                "FOUNDRY_ORCHESTRATION_RUN_STORE_PATH": "/tmp/foundry-orchestrator.db",
                "FOUNDRY_ORCHESTRATION_API_TOKEN": "orchestrator-secret",
                "FOUNDRY_ORCHESTRATION_VERIFY_TLS": "false",
                "FOUNDRY_ORCHESTRATION_SUPERVISOR_DIR": "/tmp/foundry-supervisor",
                "FOUNDRY_ORCHESTRATION_LOCAL_WORK_ROOT": "/tmp/foundry-work",
                "FOUNDRY_ORCHESTRATION_POLICY_PATH": "/tmp/orchestrator-policy.json",
            }
        )

        self.assertEqual(config.environment, DeploymentEnvironment.STAGING)
        self.assertEqual(config.port, 9001)
        self.assertTrue(config.self_host_mode)
        self.assertEqual(config.auth_provider, AuthProvider.LOCAL_PASSWORD)
        self.assertEqual(config.support_email, "support@foundry.test")
        self.assertEqual(config.bootstrap_admin_email, "admin@foundry.test")
        self.assertTrue(config.bootstrap_admin_password_present)
        self.assertEqual(config.core_url, "https://core.foundry.test")
        self.assertTrue(config.core_bootstrap_secret_present)
        self.assertEqual(config.core_realm_key_override, "__root__")
        self.assertTrue(config.anthropic_api_key_present)
        self.assertEqual(config.anthropic_api_base_url, "https://anthropic-proxy.foundry.test")
        self.assertEqual(config.anthropic_model, "claude-opus-test")
        self.assertTrue(config.github_app_private_key_present)
        self.assertTrue(config.github_webhook_secret_present)
        self.assertEqual(config.coder_url, "https://coder.foundry.test")
        self.assertTrue(config.coder_api_token_present)
        self.assertTrue(config.stripe_secret_key_present)
        self.assertTrue(config.stripe_webhook_secret_present)
        self.assertEqual(config.organization_workspace_pool_size, 8)
        self.assertEqual(config.organization_workspace_max_concurrency, 40)
        self.assertEqual(config.session_max_age_days, 30)
        self.assertFalse(config.orchestration_enabled)
        self.assertEqual(config.orchestration_mount_path, "/internal/orchestration")
        self.assertEqual(config.orchestration_run_store_path, "/tmp/foundry-orchestrator.db")
        self.assertTrue(config.orchestration_api_token_present)
        self.assertFalse(config.orchestration_verify_tls)
        self.assertEqual(config.orchestration_supervisor_dir, "/tmp/foundry-supervisor")
        self.assertEqual(config.orchestration_local_work_root, "/tmp/foundry-work")
        self.assertEqual(config.orchestration_policy_path, "/tmp/orchestrator-policy.json")

    def test_process_environment_is_used_by_default(self) -> None:
        with mock.patch.dict(
            "os.environ",
            {
                "FOUNDRY_ENVIRONMENT": "staging",
                "FOUNDRY_PUBLIC_BASE_URL": "https://server-dev.example.com",
            },
            clear=True,
        ):
            config = load_config()

        self.assertEqual(config.environment, DeploymentEnvironment.STAGING)
        self.assertEqual(config.public_base_url, "https://server-dev.example.com")


if __name__ == "__main__":
    unittest.main()
