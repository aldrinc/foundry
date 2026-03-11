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

    @patch("zerver.views.foundry_cloud._bootstrap_secret", return_value="core-secret")
    def test_sync_member_maps_admin_roles(self, mock_secret: object) -> None:
        self.client_post(
            "/api/v1/foundry/cloud/tenants/provision",
            info=json.dumps(
                {
                    "organization_id": "org-1",
                    "realm_subdomain": "acme-admin-sync",
                    "realm_name": "Acme Admin Sync",
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
            "/api/v1/foundry/cloud/tenants/acme-admin-sync/members/sync",
            info=json.dumps(
                {
                    "email": "runtime-admin@acme.test",
                    "full_name": "Runtime Admin",
                    "password": "runtime-admin-password",
                    "role": "runtime_admin",
                }
            ),
            content_type="application/json",
            headers={"X-Foundry-Core-Bootstrap-Secret": "core-secret"},
        )
        self.assert_json_success(result)

        realm = get_realm("acme-admin-sync")
        admin = UserProfile.objects.get(realm=realm, delivery_email="runtime-admin@acme.test")
        self.assertEqual(admin.role, UserProfile.ROLE_REALM_ADMINISTRATOR)

    @patch("zerver.views.foundry_cloud._bootstrap_secret", return_value="core-secret")
    def test_provision_tenant_reuses_root_realm(self, mock_secret: object) -> None:
        root_realm = get_realm("zulip")
        root_realm.string_id = ""
        root_realm.save(update_fields=["string_id"])

        result = self.client_post(
            "/api/v1/foundry/cloud/tenants/provision",
            info=json.dumps(
                {
                    "organization_id": "org-1",
                    "realm_subdomain": "__root__",
                    "realm_name": "Foundry Root",
                    "owner_email": "root-owner@acme.test",
                    "owner_full_name": "Root Owner",
                    "owner_password": "owner-password",
                    "role": "owner",
                }
            ),
            content_type="application/json",
            headers={"X-Foundry-Core-Bootstrap-Secret": "core-secret"},
        )
        self.assert_json_success(result)
        payload = self.json_response(result)

        root_realm.refresh_from_db()
        self.assertEqual(payload["realm"]["id"], root_realm.id)
        self.assertEqual(payload["realm"]["string_id"], "")
        self.assertEqual(payload["realm_created"], False)
        owner = UserProfile.objects.get(realm=root_realm, delivery_email="root-owner@acme.test")
        self.assertEqual(owner.role, UserProfile.ROLE_REALM_OWNER)

    @patch("zerver.views.foundry_cloud._bootstrap_secret", return_value="core-secret")
    def test_sync_member_adds_member_to_root_realm(self, mock_secret: object) -> None:
        root_realm = get_realm("zulip")
        root_realm.string_id = ""
        root_realm.save(update_fields=["string_id"])

        self.client_post(
            "/api/v1/foundry/cloud/tenants/provision",
            info=json.dumps(
                {
                    "organization_id": "org-1",
                    "realm_subdomain": "__root__",
                    "realm_name": "Foundry Root",
                    "owner_email": "root-owner@acme.test",
                    "owner_full_name": "Root Owner",
                    "owner_password": "owner-password",
                    "role": "owner",
                }
            ),
            content_type="application/json",
            headers={"X-Foundry-Core-Bootstrap-Secret": "core-secret"},
        )

        result = self.client_post(
            "/api/v1/foundry/cloud/tenants/__root__/members/sync",
            info=json.dumps(
                {
                    "email": "root-teammate@acme.test",
                    "full_name": "Root Teammate",
                    "password": "teammate-password",
                    "role": "member",
                }
            ),
            content_type="application/json",
            headers={"X-Foundry-Core-Bootstrap-Secret": "core-secret"},
        )
        self.assert_json_success(result)

        root_realm.refresh_from_db()
        teammate = UserProfile.objects.get(realm=root_realm, delivery_email="root-teammate@acme.test")
        self.assertEqual(teammate.role, UserProfile.ROLE_MEMBER)
