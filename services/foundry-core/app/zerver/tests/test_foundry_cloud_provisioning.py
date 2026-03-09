from __future__ import annotations

import json
from unittest.mock import patch

from zerver.lib.test_classes import ZulipTestCase
from zerver.models import UserProfile
from zerver.models.realms import get_realm


class FoundryCloudProvisioningTest(ZulipTestCase):
    @patch("zerver.views.foundry_cloud._bootstrap_secret", return_value="core-secret")
    def test_provision_tenant_creates_realm_and_owner(self, mock_secret: object) -> None:
        result = self.client_post(
            "/api/v1/foundry/cloud/tenants/provision",
            info=json.dumps(
                {
                    "organization_id": "org-1",
                    "realm_subdomain": "acme-core",
                    "realm_name": "Acme Core",
                    "owner_email": "owner@acme.test",
                    "owner_full_name": "Owner User",
                    "owner_password": "owner-password",
                    "role": "owner",
                }
            ),
            content_type="application/json",
            headers={"X-Foundry-Core-Bootstrap-Secret": "core-secret"},
        )
        self.assert_json_success(result)
        realm = get_realm("acme-core")
        self.assertEqual(realm.name, "Acme Core")
        owner = UserProfile.objects.get(realm=realm, delivery_email="owner@acme.test")
        self.assertEqual(owner.role, UserProfile.ROLE_REALM_OWNER)

    @patch("zerver.views.foundry_cloud._bootstrap_secret", return_value="core-secret")
    def test_sync_member_adds_realm_member(self, mock_secret: object) -> None:
        self.client_post(
            "/api/v1/foundry/cloud/tenants/provision",
            info=json.dumps(
                {
                    "organization_id": "org-1",
                    "realm_subdomain": "acme-sync",
                    "realm_name": "Acme Sync",
                    "owner_email": "owner@acme.test",
                    "owner_full_name": "Owner User",
                    "owner_password": "owner-password",
                    "role": "owner",
                }
            ),
            content_type="application/json",
            headers={"X-Foundry-Core-Bootstrap-Secret": "core-secret"},
        )

        result = self.client_post(
            "/api/v1/foundry/cloud/tenants/acme-sync/members/sync",
            info=json.dumps(
                {
                    "email": "teammate@acme.test",
                    "full_name": "Teammate User",
                    "password": "teammate-password",
                    "role": "member",
                }
            ),
            content_type="application/json",
            headers={"X-Foundry-Core-Bootstrap-Secret": "core-secret"},
        )
        self.assert_json_success(result)

        realm = get_realm("acme-sync")
        teammate = UserProfile.objects.get(realm=realm, delivery_email="teammate@acme.test")
        self.assertEqual(teammate.role, UserProfile.ROLE_MEMBER)
