from __future__ import annotations

import hmac
import json
import os
from typing import Any

from django.core.exceptions import ValidationError
from django.http import HttpRequest, HttpResponse
from django.views.decorators.csrf import csrf_exempt

from zerver.actions.create_realm import do_create_realm
from zerver.actions.create_user import do_create_user, do_reactivate_user
from zerver.decorator import require_post
from zerver.forms import check_subdomain_available
from zerver.lib.exceptions import JsonableError
from zerver.lib.response import json_success
from zerver.models import Realm, UserProfile
from zerver.models.realms import get_realm


def _bootstrap_secret() -> str:
    return os.getenv("FOUNDRY_CLOUD_BOOTSTRAP_SECRET", "").strip()


def _require_bootstrap_secret(request: HttpRequest) -> None:
    expected = _bootstrap_secret()
    if not expected:
        raise JsonableError("Foundry Cloud bootstrap secret is not configured on this server.")
    provided = request.headers.get("X-Foundry-Core-Bootstrap-Secret", "").strip()
    if not provided or not hmac.compare_digest(provided, expected):
        raise JsonableError("Invalid Foundry Cloud bootstrap secret.")


def _payload_from_request(request: HttpRequest) -> dict[str, Any]:
    try:
        payload = json.loads(request.body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise JsonableError("Request body must be valid JSON.") from exc
    if not isinstance(payload, dict):
        raise JsonableError("Request body must be a JSON object.")
    return payload


def _role_from_value(value: str) -> int:
    normalized = value.strip().lower()
    if normalized == "owner":
        return UserProfile.ROLE_REALM_OWNER
    if normalized in {"admin", "runtime_admin", "billing_admin"}:
        return UserProfile.ROLE_REALM_ADMIN
    return UserProfile.ROLE_MEMBER


def _ensure_user(
    *,
    realm: Realm,
    email: str,
    full_name: str,
    password: str,
    role: str,
    realm_creation: bool,
) -> tuple[UserProfile, bool]:
    user = UserProfile.objects.filter(realm=realm, delivery_email__iexact=email).first()
    created = False
    if user is None:
        if not password:
            raise JsonableError("A password is required to provision a new tenant user.")
        user = do_create_user(
            email,
            password,
            realm,
            full_name,
            role=_role_from_value(role),
            realm_creation=realm_creation,
            tos_version=UserProfile.TOS_VERSION_BEFORE_FIRST_LOGIN,
            acting_user=None,
        )
        created = True
    else:
        changed = False
        if full_name and user.full_name != full_name:
            user.full_name = full_name
            changed = True
        target_role = _role_from_value(role)
        if user.role != target_role:
            user.role = target_role
            changed = True
        if changed:
            user.save(update_fields=["full_name", "role"])
        if not user.is_active:
            do_reactivate_user(user, acting_user=None)
    return user, created


@csrf_exempt
@require_post
def foundry_cloud_provision_tenant(request: HttpRequest) -> HttpResponse:
    _require_bootstrap_secret(request)
    payload = _payload_from_request(request)

    realm_subdomain = str(payload.get("realm_subdomain", "")).strip().lower()
    realm_name = str(payload.get("realm_name", "")).strip()
    owner_email = str(payload.get("owner_email", "")).strip().lower()
    owner_full_name = str(payload.get("owner_full_name", "")).strip()
    owner_password = str(payload.get("owner_password", ""))
    role = str(payload.get("role", "owner")).strip().lower() or "owner"

    if not realm_subdomain or not realm_name or not owner_email or not owner_full_name:
        raise JsonableError(
            "realm_subdomain, realm_name, owner_email, and owner_full_name are required."
        )

    realm = Realm.objects.filter(string_id=realm_subdomain).first()
    realm_created = False
    if realm is None:
        try:
            check_subdomain_available(realm_subdomain, allow_reserved_subdomain=False)
        except ValidationError as exc:
            raise JsonableError(exc.message) from exc
        realm = do_create_realm(
            realm_subdomain,
            realm_name,
            org_type=Realm.ORG_TYPES["business"]["id"],
            default_language="en",
            invite_required=True,
        )
        realm_created = True

    user, user_created = _ensure_user(
        realm=realm,
        email=owner_email,
        full_name=owner_full_name,
        password=owner_password,
        role=role,
        realm_creation=realm_created,
    )

    return json_success(
        request,
        data={
            "realm": {
                "id": realm.id,
                "string_id": realm.string_id,
                "name": realm.name,
                "url": realm.url,
            },
            "owner": {
                "user_id": user.id,
                "email": user.delivery_email,
                "full_name": user.full_name,
                "role": user.role,
            },
            "realm_created": realm_created,
            "owner_created": user_created,
        },
    )


@csrf_exempt
@require_post
def foundry_cloud_sync_tenant_member(request: HttpRequest, realm_subdomain: str) -> HttpResponse:
    _require_bootstrap_secret(request)
    payload = _payload_from_request(request)

    email = str(payload.get("email", "")).strip().lower()
    full_name = str(payload.get("full_name", "")).strip()
    password = str(payload.get("password", ""))
    role = str(payload.get("role", "member")).strip().lower() or "member"

    if not email or not full_name:
        raise JsonableError("email and full_name are required.")

    realm = get_realm(realm_subdomain)
    user, user_created = _ensure_user(
        realm=realm,
        email=email,
        full_name=full_name,
        password=password,
        role=role,
        realm_creation=False,
    )

    return json_success(
        request,
        data={
            "member": {
                "user_id": user.id,
                "email": user.delivery_email,
                "full_name": user.full_name,
                "role": user.role,
            },
            "created": user_created,
            "realm": {
                "id": realm.id,
                "string_id": realm.string_id,
                "url": realm.url,
            },
        },
    )
